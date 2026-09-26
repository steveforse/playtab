# frozen_string_literal: true

require "nokogiri"

module Tef2
  # Writes the bounded score documents used by Playtab as TEF files. The
  # writers deliberately keep the file format small and deterministic: one
  # five-string track, one voice, and the notes/metadata that the native
  # importers can read back without another converter.
  class Exporter
    class Invalid < StandardError; end

    TEF2 = "tef2"
    TEF3 = "tef3"
    MAX_MEASURES = 256
    TEF2_TICKS_PER_QUARTER = 256
    TEF3_UNITS_PER_QUARTER = 16
    # TablEdit's default note dynamic; nearly every note in real files has it.
    DEFAULT_DYNAMIC = 2
    DEFAULT_INSTRUMENT = { midi_voice: 105, midi_bank: 0, capo: 0, banjo5: 0, clef: 0, middle_c: 0 }.freeze
    # TEF metadata written by the importer that export reads back.
    CONSUMED_METADATA = /\ATEF (?:fingering .+|effect[23] \d+|dynamic \d+|stroke \d+|grace effect \d+|let ring|slap|fade (?:in|out))\z/

    def self.chord_values(chord)
      values = chord[:strings].to_a.first(5)
      return Array.new(5, 0) unless values.length == 5

      values.map { |fret| fret.to_i.negative? ? 0xFF : fret.to_i.clamp(0, 31) }
    end

    def self.export(document, version: TEF2)
      model = Model.from(document)
      bytes = case version.to_s
      when TEF2 then LegacyWriter.build(model)
      when TEF3 then TableditWriter.build(model)
      else raise Invalid, "Unsupported TEF export version."
      end
      warnings = model.warnings.dup
      if version.to_s == TEF2 && model.reading_list.any?
        warnings << "TEF2 export writes the measures in written order; repeats, endings and jumps are not represented."
      end
      if version.to_s == TEF2 && model.notes.any? { |note| note[:annotation] && ![ 2, 4 ].include?(note[:annotation]) }
        warnings << "TEF2 can encode only the imported 1 and 3 fingering markers; other fingering and thumb markers remain unresolved metadata."
      end
      { bytes: bytes, warnings: warnings.uniq, version: version.to_s }
    rescue Nokogiri::XML::SyntaxError
      raise Invalid, "Imported MusicXML is invalid."
    end

    class Model
      attr_reader :title, :tempo, :tuning, :measures, :notes, :texts, :chords, :lyrics, :warnings, :instrument, :reading_list

      def self.from(document)
        unless document.is_a?(Hash)
          raise Invalid, "Score must be an object."
        end

        document["version"].to_i == 1 ? from_native(document) : from_musicxml(document)
      end

      def self.from_native(document)
        raise Invalid, "Unsupported score version." unless document["version"] == 1
        measures = document["measures"]
        raise Invalid, "Native score has no measures." unless measures.is_a?(Array) && measures.any?

        notes = []
        normalized_measures = measures.each_with_index.map do |measure, measure_index|
          beats = measure["beats"]
          unless beats.is_a?(Array) && [ 4, 8, 16 ].include?(beats.length)
            raise Invalid, "Native score contains an unsupported measure."
          end
          beat_ticks = TEF2_TICKS_PER_QUARTER * 4 / beats.length
          measure_ticks = TEF2_TICKS_PER_QUARTER * 4
          note_durations = { "q" => measure_ticks / 4, "8" => measure_ticks / 8, "16" => measure_ticks / 16 }
          beats.each_with_index do |beat, beat_index|
            Array(beat["notes"]).each do |note|
              notes << {
                measure: measure_index,
                position: beat_index * beat_ticks,
                duration: note_durations.fetch(note["duration"], beat_ticks),
                string: note["string"].to_i - 1,
                fret: note["fret"].to_i,
                effect1: 0,
                effect2: 0,
                effect3: 0,
                annotation: nil,
                fingering: nil,
                tie: false,
                tuplet: false,
                grace: false
              }
            end
            notes
          end
          { numerator: 4, denominator: 4 }
        end
        raise Invalid, "The score must contain at least one note." if notes.empty?

        new(
          title: document["title"].to_s,
          tempo: document["tempo"].to_i,
          tuning: document["tuning"],
          measures: normalized_measures,
          notes: notes,
          texts: [],
          chords: [],
          lyrics: nil,
          warnings: []
        )
      end

      def self.from_musicxml(document)
        source = document["source"]
        raise Invalid, "Imported MusicXML is invalid." unless source.is_a?(String)
        xml = Nokogiri::XML::Document.parse(source) { |config| config.strict.nonet }
        xml.remove_namespaces!
        raise Invalid, "Imported MusicXML root is missing." unless xml.root&.name == "score-partwise"

        part = xml.at_xpath("//part")
        raise Invalid, "Imported MusicXML has no part." unless part
        measure_nodes = part.xpath("./measure")
        raise Invalid, "Imported MusicXML has no measures." if measure_nodes.empty? || measure_nodes.length > MAX_MEASURES

        measures = []
        notes = []
        texts = []
        chords = []
        warnings = []
        divisions = 1
        target_staff = measure_nodes.any? { |measure| measure.xpath("./note[staff='2']").any? } ? "2" : nil
        tuning = nil
        tempo = nil
        seen_texts = {}
        seen_chords = {}
        instrument = read_instrument(xml, measure_nodes.first)
        capo = instrument[:capo]
        lost_graces = 0

        measure_nodes.each_with_index do |measure, measure_index|
          divisions = measure.at_xpath("./attributes/divisions")&.text.to_i.positive? ? measure.at_xpath("./attributes/divisions").text.to_i : divisions
          signature = time_signature(measure, measures.last || { numerator: 4, denominator: 4 })
          measures << signature
          tuning ||= read_tuning(measure)
          tempo ||= read_tempo(measure)

          measure.xpath("./direction/direction-type/words").each do |words|
            text = words.text.strip
            # A legacy "Capo N" direction is the capo itself, not a text.
            next if measure_index.zero? && capo.positive? && text.match?(/\ACapo \d+\z/i)
            # D.C., D.S., To Coda and Fine are playback marks, not texts.
            next if words.parent.parent.at_xpath("./sound[@dacapo or @dalsegno or @tocoda or @fine or @segno or @coda]")
            position = xml_ticks(words.parent.parent.at_xpath("./offset")&.text.to_i, divisions)
            string = metadata_string(words.parent.parent["data-playtab-string"])
            key = [ measure_index, position, text, string ]
            if !text.empty? && !seen_texts[key]
              direction = words.parent.parent
              texts << {
                measure: measure_index,
                position: position,
                text: text,
                string: string
              }.compact
              seen_texts[key] = true
            end
          end
          measure.xpath("./harmony").each do |harmony|
            name = chord_name(harmony)
            position = xml_ticks(harmony.at_xpath("./offset")&.text.to_i, divisions)
            string = metadata_string(harmony["data-playtab-string"])
            strings = chord_strings(harmony["data-playtab-strings"])
            first_fret = metadata_first_fret(harmony["data-playtab-first-fret"])
            key = [ measure_index, position, name, string, strings, first_fret ]
            if !name.empty? && !seen_chords[key]
              chords << {
                measure: measure_index,
                position: position,
                name: name,
                string: string,
                strings: strings,
                first_fret: first_fret
              }.compact
              seen_chords[key] = true
            end
          end

          cursor = 0
          previous_note_position = nil
          # TablEdit stores a grace note on the note it leads into, on the
          # same string, so each grace waits for that note.
          pending_graces = {}
          measure.element_children.each do |element|
            case element.name
            when "backup"
              cursor = [ cursor - xml_ticks(element.at_xpath("./duration")&.text.to_i, divisions), 0 ].max
              previous_note_position = nil
              lost_graces += pending_graces.length
              pending_graces.clear
            when "forward"
              cursor += xml_ticks(element.at_xpath("./duration")&.text.to_i, divisions)
            when "note"
              staff = element.at_xpath("./staff")&.text
              selected = target_staff ? staff == target_staff : element.at_xpath("./notations/technical/string")
              duration = xml_ticks(element.at_xpath("./duration")&.text.to_i, divisions)
              if selected && element.at_xpath("./rest")
                cursor += duration
                previous_note_position = nil
              elsif selected
                technical = element.at_xpath("./notations/technical")
                string = technical&.at_xpath("./string")&.text.to_i
                fret = technical&.at_xpath("./fret")&.text.to_i
                fret += capo if string == 5 && capo.positive?
                if string.between?(1, 5) && fret >= 0 && element.at_xpath("./grace")
                  # An after-grace (it steals time from the note before it)
                  # has no TablEdit equivalent.
                  if element.at_xpath("./grace[@steal-time-previous]") || pending_graces.key?(string) || fret > 0x1F
                    lost_graces += 1
                  else
                    pending_graces[string] = { grace_fret: fret, grace_effect: metadata_value(technical, "grace effect").to_i & 0x07 }
                  end
                elsif string.between?(1, 5) && fret >= 0
                  chord_note = element.at_xpath("./chord")
                  position = chord_note && previous_note_position ? previous_note_position : cursor
                  note = note_from_xml(element, measure_index, position, duration, string, fret)
                  (grace = pending_graces.delete(string)) ? note.merge!(grace, grace: true) : note[:grace] = false
                  notes << note
                  cursor += duration unless chord_note
                  previous_note_position = position
                end
              end
            end
          end
          lost_graces += pending_graces.length
        end

        raise Invalid, "Imported MusicXML contains no tablature notes." if notes.empty?
        tuning ||= FullMusicxmlBuilder::DEFAULT_TUNING
        tempo ||= 120
        warnings.concat(loss_warnings(xml, target_staff, notes, measures))
        warnings << "Some grace notes are not represented: TablEdit keeps one grace note before a note on the same string." if lost_graces.positive?
        reading_list = ReadingList.sequences(ReadingList.playback_order(reading_bars(measure_nodes)))
        if reading_list.length > ReadingList::MAX_SEQUENCES
          warnings << "The playing order needs more than #{ReadingList::MAX_SEQUENCES} reading-list ranges; the TEF plays in written order."
          reading_list = []
        end
        fifth_capo = xml.at_xpath("//miscellaneous-field[@name='playtab-fifth-string-capo']")&.text.to_i
        warnings << "The 5th-string capo is written at capo + 5; fret #{fifth_capo} is not represented." if fifth_capo.positive? && fifth_capo != capo + 5

        new(
          title: document["title"].to_s,
          tempo: tempo.clamp(30, 240),
          tuning: tuning,
          measures: measures,
          notes: notes.each_with_index { |note, index| note[:index] = index },
          texts: texts,
          chords: chords,
          lyrics: xml.at_xpath("//miscellaneous-field[@name='playtab-lyrics']")&.text,
          warnings: warnings.uniq,
          instrument: instrument,
          reading_list: reading_list
        )
      end

      # Repeat signs, endings and jump marks per measure, in the shape
      # ReadingList.playback_order reads.
      def self.reading_bars(measure_nodes)
        active = []
        measure_nodes.map do |measure|
          bar = ReadingList.blank_bar
          measure.xpath("./barline").each do |barline|
            repeat = barline.at_xpath("./repeat")
            bar[:forward] ||= repeat&.[]("direction") == "forward"
            bar[:backward] = [ repeat["times"].to_i, 2 ].max if repeat&.[]("direction") == "backward"
            ending = barline.at_xpath("./ending")
            active = ending["number"].to_s.split(/[,\s]+/).map(&:to_i).select(&:positive?) if ending && ending["type"] == "start"
          end
          bar[:endings] = active
          active = [] if measure.at_xpath("./barline/ending[@type='stop' or @type='discontinue']")
          sound = ->(name) { measure.at_xpath("./sound[@#{name}] | ./direction/sound[@#{name}]") != nil }
          bar[:segno] = sound.("segno") || measure.at_xpath("./direction/direction-type/segno") != nil
          bar[:coda] = sound.("coda") || measure.at_xpath("./direction/direction-type/coda") != nil
          bar[:to_coda] = sound.("tocoda")
          bar[:dacapo] = sound.("dacapo")
          bar[:dalsegno] = sound.("dalsegno")
          bar[:fine] = sound.("fine")
          bar
        end
      end

      # The score part's MIDI program and bank (one-based in MusicXML), the
      # capo, and the TablEdit clef fields kept by the importer. Imports
      # before this change wrote the zero-based banjo program 105 as-is.
      def self.read_instrument(xml, first_measure)
        program = xml.at_xpath("//score-part/midi-instrument/midi-program")&.text&.to_i
        legacy = program == 105 && xml.at_xpath("//score-part/score-instrument/instrument-name")&.text == "Banjo"
        bank = xml.at_xpath("//score-part/midi-instrument/midi-bank")&.text&.to_i
        capo = first_measure.at_xpath("./attributes/staff-details/capo")&.text&.to_i
        capo ||= first_measure.xpath("./direction/direction-type/words").filter_map { |words| words.text.strip[/\ACapo (\d+)\z/i, 1]&.to_i }.first
        field = ->(name) { xml.at_xpath("//miscellaneous-field[@name='#{name}']")&.text.to_i }
        capo = capo.to_i.clamp(0, 24)
        {
          midi_voice: program.nil? || legacy ? 105 : (program - 1).clamp(0, 127),
          midi_bank: bank.nil? ? 0 : (bank - 1).clamp(0, 255),
          capo: capo,
          banjo5: xml.at_xpath("//miscellaneous-field[@name='playtab-tef-banjo5']") ? field.("playtab-tef-banjo5").clamp(0, 255) : capo,
          clef: field.("playtab-tef-clef").clamp(0, 255),
          middle_c: field.("playtab-tef-middle-c").clamp(0, 255)
        }
      end

      def self.metadata_value(technical, name)
        technical&.xpath("./other-technical")&.each do |node|
          value = node.text.strip[/\ATEF #{name} (\d+)\z/, 1]
          return value.to_i if value
        end
        nil
      end

      def initialize(title:, tempo:, tuning:, measures:, notes:, texts:, chords:, lyrics:, warnings:, instrument: {}, reading_list: [])
        @title = title
        @tempo = tempo
        @tuning = Array(tuning).map(&:to_i)
        @measures = measures
        @notes = notes
        @texts = texts
        @chords = chords
        @lyrics = lyrics.to_s.empty? ? nil : lyrics.to_s
        @warnings = warnings
        @instrument = DEFAULT_INSTRUMENT.merge(instrument)
        @reading_list = reading_list
        validate!
      end

      def validate!
        raise Invalid, "A TEF export needs five tuning values." unless tuning.length == 5
        raise Invalid, "TEF export supports 1–256 measures." unless measures.length.between?(1, MAX_MEASURES)
        unless tuning.all? { |pitch| pitch.between?(0, 255) }
          raise Invalid, "Tuning contains a pitch outside the TEF range."
        end
        notes.each do |note|
          raise Invalid, "A note string must be between 1 and 5." unless note[:string].between?(0, 4)
          raise Invalid, "A fret is outside the selected TEF range." unless note[:fret].between?(0, 49)
          raise Invalid, "A note lies outside its measure." unless note[:measure].between?(0, measures.length - 1)
        end
      end

      def self.time_signature(measure, fallback)
        time = measure.at_xpath("./attributes/time")
        numerator = time&.at_xpath("./beats")&.text.to_i
        denominator = time&.at_xpath("./beat-type")&.text.to_i
        return fallback.dup unless numerator.positive? && denominator.positive?

        { numerator: numerator, denominator: denominator }
      end

      def self.read_tuning(measure)
        details = measure.at_xpath("./attributes/staff-details[@number='2']") || measure.at_xpath("./attributes/staff-details")
        return unless details

        values = details.xpath("./staff-tuning").sort_by { |node| node["line"].to_i }.map do |node|
          step = node.at_xpath("./tuning-step")&.text.to_s
          alter = node.at_xpath("./tuning-alter")&.text.to_f
          octave = node.at_xpath("./tuning-octave")&.text.to_i
          pitch = %w[C D E F G A B].index(step.upcase)
          next unless pitch

          midi = (octave + 1) * 12 + [ 0, 2, 4, 5, 7, 9, 11 ][pitch] + alter.round
          midi
        end.compact
        values.length == 5 ? values.reverse : nil
      end

      def self.read_tempo(measure)
        value = measure.at_xpath("./direction/direction-type/metronome/per-minute")&.text.to_i
        value.positive? ? value : nil
      end

      def self.xml_ticks(duration, divisions)
        ((duration.to_i * TEF2_TICKS_PER_QUARTER).to_f / [ divisions, 1 ].max).round
      end

      def self.note_from_xml(element, measure, position, duration, string, fret)
        technical = element.at_xpath("./notations/technical")
        fingering = technical&.at_xpath("./fingering")&.text.to_s
        thumb = technical&.xpath("./other-technical").any? do |node|
          [ "TEF fingering T", "TEF fingering code 6" ].include?(node.text.strip)
        end
        technique = element.xpath("./notations/technical/*[self::hammer-on or self::pull-off or self::slide or self::bend]").find do |node|
          node["type"] != "stop"
        end
        effect3 = metadata_value(technical, "effect3").to_i & 0x0F
        effect1 = case technique&.name
        when "hammer-on" then 1
        when "pull-off" then 2
        when "slide" then 3
        when "bend" then technique.at_xpath("./bend-alter")&.text.to_f == 0.5 ? 4 : (technique.at_xpath("./release") ? 13 : 12)
        else primary_effect(element, effect3)
        end
        effect2 = metadata_value(technical, "effect2") || secondary_effect(element, technical)
        annotation = if thumb
          6
        elsif fingering.to_i.between?(1, 4)
          { 1 => 2, 2 => 3, 3 => 4, 4 => 5 }[fingering.to_i]
        end
        {
          measure: measure,
          position: position,
          duration: [ duration, 1 ].max,
          string: string - 1,
          fret: fret,
          effect1: effect1,
          effect2: effect2 & 0x0F,
          effect3: effect3,
          dynamic: (metadata_value(technical, "dynamic") || DEFAULT_DYNAMIC) & 0x07,
          stroke: metadata_value(technical, "stroke").to_i & 0x07,
          annotation: annotation,
          fingering: thumb ? "T" : fingering.to_i.between?(1, 4) ? fingering.to_i : nil,
          tie: element.xpath("./notations/tied[@type='start' or @type='continue']").any?,
          tuplet: element.at_xpath("./time-modification") != nil
        }
      end

      # TablEdit primary effects other than the editable hammer-on,
      # pull-off, slide and bend, read from how the importer renders them.
      # A rendering the note's secondary effect already accounts for is not
      # also a primary effect.
      def self.primary_effect(element, effect3)
        technical = element.at_xpath("./notations/technical")
        if technical&.at_xpath("./harmonic/natural") && effect3 != 6 then 6
        elsif technical&.at_xpath("./harmonic/artificial") && effect3 != 7 then 7
        elsif technical&.at_xpath("./tap") then 9
        elsif element.at_xpath("./notations/ornaments/wavy-line") then 10
        elsif element.at_xpath("./notations/ornaments/tremolo") then 11
        elsif element.at_xpath("./notations/arpeggiate") && effect3 != 3 then 14
        elsif element.at_xpath("./notehead")&.text == "x" && effect3 != 10 then 15
        else 0
        end
      end

      # The secondary effect of MusicXML that did not come from a TEF3
      # import, which carries the exact value as metadata instead.
      def self.secondary_effect(element, technical)
        labels = technical ? technical.xpath("./other-technical").map { |node| node.text.strip } : []
        if element.at_xpath("./notations/articulations/staccato") then 7
        elsif element.at_xpath("./notehead[@parentheses='yes']") then 4
        elsif labels.include?("TEF let ring") then 1
        elsif labels.include?("TEF slap") then 2
        elsif labels.include?("TEF fade in") then 8
        elsif labels.include?("TEF fade out") then 9
        else 0
        end
      end

      def self.chord_name(harmony)
        root = harmony.at_xpath("./root/root-step")&.text.to_s
        alter = harmony.at_xpath("./root/root-alter")&.text.to_f
        accidental = alter == 1 ? "#" : alter == -1 ? "b" : ""
        kind_node = harmony.at_xpath("./kind")
        display_kind = kind_node&.[]("text").to_s
        kind = display_kind.empty? ? kind_node&.text.to_s.strip : display_kind
        suffix = display_kind.empty? && %w[major maj].include?(kind.downcase) ? "" : kind
        root.empty? ? "" : "#{root}#{accidental}#{suffix}"
      end

      def self.metadata_string(value)
        return if value.nil?

        parsed = value.to_i
        parsed if parsed.between?(0, 4)
      end

      def self.chord_strings(value)
        strings = value.to_s.split(",").map(&:to_i)
        strings if strings.length == 5 && strings.all? { |fret| fret.between?(-1, 49) }
      end

      def self.metadata_first_fret(value)
        return if value.nil?

        parsed = value.to_i
        parsed if parsed.positive?
      end

      def self.loss_warnings(xml, target_staff, notes, measures)
        warnings = []
        warnings << "Only the first tablature part is exported; additional parts or independent voices are not represented." if xml.xpath("//part").length > 1
        warnings << "Timed lyrics are not represented in TEF export; the standalone lyric section is preserved only where the selected TEF version supports it." if xml.xpath("//note/lyric").any?
        unsupported_technical = xml.xpath("//notations/articulations/*[not(self::staccato)] | //notations/ornaments/*[not(self::wavy-line or self::tremolo)]").to_a
        unsupported_technical.concat(xml.xpath("//notations/technical/other-technical").reject { |node| node.text.strip.match?(CONSUMED_METADATA) })
        warnings << "Some MusicXML techniques are not represented in the selected TEF export." if unsupported_technical.any?
        warnings << "MusicXML contains rests or independent voices; TEF export keeps note positions but does not preserve those voice details." if xml.xpath("//rest | //voice[. != '1']").any?
        # TablEdit 3's encoding of a tempo change is unknown (no sample file
        # has one), so only the opening tempo is written.
        tempos = xml.xpath("//part[1]/measure/direction").filter_map do |direction|
          value = direction.at_xpath("./sound/@tempo")&.value || direction.at_xpath("./direction-type/metronome/per-minute")&.text
          value.to_f.round if value
        end.chunk_while { |a, b| a == b }.map(&:first)
        warnings << "TEF export keeps the opening tempo; later tempo changes are not represented." if tempos.length > 1
        warnings << "Some note timings were rounded to TEF position units." if notes.any? { |note| (note[:position] % 4).positive? || (note[:duration] % 4).positive? }
        warnings << "The source contains changing time signatures." if measures.uniq.length > 1
        warnings
      end
    end

    module Binary
      module_function

      def u16(bytes, offset, value)
        bytes[offset, 2] = [ value & 0xFF, (value >> 8) & 0xFF ]
      end

      def u32(bytes, offset, value)
        bytes[offset, 4] = [ value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF ]
      end

      def text(value, length)
        bytes = Array.new(length, 0)
        bytes[0, [ value.to_s.encode(Encoding::UTF_8).bytes.length, length - 1 ].min] = value.to_s.encode(Encoding::UTF_8).bytes.first(length - 1)
        bytes
      end

      def info(title)
        bytes = Array.new(200, 0)
        encoded = title.to_s.encode(Encoding::UTF_8).bytes.first(198)
        bytes[0, encoded.length] = encoded
        bytes[encoded.length] = 0
        bytes
      end

      def duration_code(ticks, table)
        table.min_by { |code, value| (value - ticks.to_i).abs }.first
      end
    end

    class LegacyWriter
      DURATION_CODES = (0..31).to_h { |code| [ code, FullParser.duration_ticks(code) ] }.freeze
      FOOTER_SIZE = 480
      DEFAULT_FOOTER_LAYOUT = "001111111000=0J1:@899<>700000024U00/0000\0" \
        "00000001<D1.1101110::=I><0000000000000000000000\0" \
        "0000000Page &p / &n"
      DEFAULT_FOOTER_FIRST_HEADER = "&c&2&t &c&6&s &r&3&m "
      DEFAULT_FOOTER_OTHER_HEADER = "&r&3&t - &3&s "
      # These fields are not consumed by the TuxGuitar-compatible reader, but
      # they are part of the legacy TEF2 header expected by TEF View. They
      # describe the 4/4 layout and the single-track export produced here.
      LEGACY_LAYOUT_MARKER = 3
      LEGACY_POSITION_UNIT = 480
      LEGACY_TRACK_MARKER = 2
      LEGACY_HEADER_FLAGS = 1
      LEGACY_HEADER_WIDTH = 632
      LEGACY_HEADER_STYLE = 163

      def self.build(model)
        raise Invalid, "TEF2 export supports 4/4 measures only." unless model.measures.all? { |sig| sig == { numerator: 4, denominator: 4 } }
        model.notes.each do |note|
          raise Invalid, "TEF2 cannot represent frets above 24." if note[:fret] > 24
          raise Invalid, "TEF2 cannot represent changing voice or grace-note timing." if note[:grace]
        end

        components = components_for(model)
        bytes = Array.new(FullParser::HEADER_SIZE + components.length * FullParser::COMPONENT_SIZE, 0)
        bytes[0, 200] = Binary.info(model.title)
        Binary.u16(bytes, 200, model.measures.length)
        bytes[202] = 4
        bytes[204] = 4
        bytes[205] = LEGACY_LAYOUT_MARKER
        Binary.u16(bytes, 220, model.tempo.clamp(30, 240))
        Binary.u16(bytes, 226, LEGACY_POSITION_UNIT)
        Binary.u16(bytes, 230, LEGACY_TRACK_MARKER)
        bytes[239] = LEGACY_HEADER_FLAGS
        Binary.u16(bytes, 256, components.length)
        Binary.u16(bytes, 246, LEGACY_HEADER_WIDTH)
        bytes[249] = LEGACY_HEADER_STYLE
        bytes[228] = model.texts.length
        bytes[236] = model.chords.length
        bytes[238] = model.lyrics ? 1 : 0
        bytes[240] = 5
        bytes[241] = 0
        offset = FullParser::HEADER_SIZE
        components.each do |component|
          bytes[offset, 6] = component
          offset += 6
        end
        tail = tail_for(model)
        bytes.concat(tail)
        bytes.pack("C*")
      end

      def self.components_for(model)
        entries = []
        occupied = {}

        model.notes.reverse_each do |note|
          position = candidate_position(note)
          next if occupied[position]

          entries << [ position, note_component(note) ]
          occupied[position] = true
        end
        add_marker_entries(entries, occupied, model.texts) { |item, index| text_component(item, index) }
        add_marker_entries(entries, occupied, model.chords) { |item, index| chord_component(item, index) }
        entries.sort_by(&:first).map { |_position, component| component }
      end

      def self.add_marker_entries(entries, occupied, items)
        seen = {}
        items.each_with_index do |item, index|
          key = [ item[:measure].to_i, item[:position].to_i, item[:text] || item[:name] ]
          next if seen[key]

          positioned, position = available_marker_position(item, occupied)
          next unless positioned

          entries << [ position, yield(positioned, index) ]
          occupied[position] = true
          seen[key] = true
        end
      end

      def self.available_marker_position(item, occupied)
        measure = item[:measure].to_i
        base_units = item[:position].to_i / 4
        preferred_string = item[:string].to_i.clamp(0, 4)
        strings = [ preferred_string, 0, 1, 2, 3, 4 ].uniq
        units = (base_units..255).to_a + (0...base_units).to_a
        units.each do |position_units|
          strings.each do |string|
            position = (measure * 5 * 256) + (string * 256) + position_units
            next if occupied[position]

            return [ item.merge(string: string, position: position_units * 4), position ]
          end
        end
        [ nil, nil ]
      end

      def self.candidate_position(item)
        measure = item[:measure].to_i
        string = item[:string].to_i
        position = item[:position].to_i
        measure * 5 * 256 + string * 256 + (position / 4)
      end

      def self.logical_position(item)
        candidate = candidate_position(item)
        [ candidate & 0xFF, (candidate / 256) & 0xFF ]
      end

      def self.note_component(note)
        b0, b1 = logical_position(note)
        fret = note[:fret] + 1
        annotation = note[:annotation]
        b2 = fret | (annotation ? 0x20 : 0)
        b3 = Binary.duration_code(note[:duration], DURATION_CODES)
        [ b0, b1, b2, b3, note[:effect1].to_i & 0xFF, annotation || note[:effect2].to_i & 0xFF ]
      end

      def self.text_component(text, index)
        b0, b1 = logical_position(text)
        [ b0, b1, FullParser::TYPE_TEXT, index, 0, 0 ]
      end

      def self.chord_component(chord, index)
        b0, b1 = logical_position(chord)
        [ b0, b1, FullParser::TYPE_CHORD, index, 0, 0 ]
      end

      def self.tail_for(model)
        bytes = []
        model.texts.each do |text|
          encoded = text[:text].to_s.encode(Encoding::UTF_8).bytes
          bytes.concat([ encoded.length + 1, 0, *encoded, 0 ])
        end
        model.chords.each do |chord|
          record = Array.new(32, 0xFF)
          record[0, 5] = Exporter.chord_values(chord)
          record[14, 16] = Binary.text(chord[:name], 16)
          bytes.concat(record)
        end
        if model.lyrics
          encoded = model.lyrics.encode(Encoding::UTF_8).bytes
          length = encoded.length + 1
          bytes.concat([ length & 0xFF, (length >> 8) & 0xFF, *encoded, 0 ])
        end
        track = Array.new(50, 0)
        track[0] = 5
        track[4] = 99
        track[8] = 105
        track[16] = 16
        track[17] = 7
        model.tuning.each_with_index { |pitch, index| track[20 + index] = 96 - pitch }
        track[32, 16] = Binary.text(model.title, 16)
        bytes + track + footer
      end

      def self.footer
        bytes = Array.new(FOOTER_SIZE, 0)
        bytes[0, DEFAULT_FOOTER_LAYOUT.bytes.length] = DEFAULT_FOOTER_LAYOUT.bytes
        bytes[224, DEFAULT_FOOTER_FIRST_HEADER.bytes.length] = DEFAULT_FOOTER_FIRST_HEADER.bytes
        bytes[352, DEFAULT_FOOTER_OTHER_HEADER.bytes.length] = DEFAULT_FOOTER_OTHER_HEADER.bytes
        bytes
      end
    end

    class TableditWriter
      # TablEdit 3.00 files reserve the first 0x100 bytes for the fixed
      # header.  The parser can read a shorter synthetic header, but TefView
      # validates the real container layout before it opens the file.
      HEADER_SIZE = 0x100

      DURATION_CODES = {
        0 => 1024, 1 => 768, 3 => 512, 4 => 384, 6 => 256, 7 => 192,
        9 => 128, 10 => 96, 12 => 64, 13 => 48, 15 => 32, 18 => 16,
        19 => 896, 22 => 448, 25 => 224, 28 => 112
      }.freeze
      TUPLET_CODES = { 512 => 2, 256 => 5, 128 => 8, 64 => 11, 32 => 14, 16 => 17 }.freeze

      def self.build(model)
        sections = []
        header = Array.new(HEADER_SIZE, 0)
        header[0, 4] = [ 0x10, 0x00, 0x01, 0x03 ]
        Binary.u16(header, 0x04, 0x00A2)
        Binary.u16(header, 0x1C, 0x0301)
        header[0x38, 4] = "debt".bytes
        Binary.u16(header, 6, model.tempo.clamp(30, 240))
        Binary.u16(header, 0xCA, 4)
        Binary.u16(header, 0xCC, 0x0A04)

        title_offset = append_section(sections, text_record(model.title))
        lyrics_offset = append_section(sections, free_text_record(model.lyrics))
        text_block_offset = append_section(sections, text_block(model.texts))
        measures_offset = append_section(sections, measures_section(model))
        instruments_offset = append_section(sections, instrument_section(model))
        texts_offset = model.texts.empty? ? 0 : text_block_offset + 3
        chords_offset = model.chords.empty? ? 0 : append_section(sections, chords_section(model.chords))
        content_offset = append_section(sections, content_section(model))
        reading_list_offset = model.reading_list.empty? ? 0 : append_section(sections, reading_list_section(model.reading_list))

        Binary.u32(header, 0x3C, content_offset)
        Binary.u32(header, 0x40, title_offset)
        Binary.u32(header, 0x4C, lyrics_offset)
        Binary.u32(header, 0x50, text_block_offset)
        Binary.u32(header, 0x54, texts_offset)
        Binary.u32(header, 0x58, chords_offset)
        Binary.u32(header, 0x5C, measures_offset)
        Binary.u32(header, 0x60, instruments_offset)
        Binary.u32(header, 0x80, reading_list_offset)
        (header + sections.flatten).pack("C*")
      end

      def self.append_section(sections, bytes)
        offset = HEADER_SIZE + sections.sum(&:length)
        sections << bytes
        offset
      end

      def self.measures_section(model)
        # The table records are eight bytes, while the table's declared
        # structure size is twelve in files written by TablEdit.
        bytes = [ 12, 0, model.measures.length, 0, 0, 0, 0, 0 ]
        model.measures.each do |signature|
          bytes.concat([ 0, 0, 0, 0, signature[:denominator], signature[:numerator], 0, 0 ])
        end
        bytes
      end

      def self.instrument_section(model)
        # Laid out as in files written by TablEdit, including its default
        # output flags (0x0710).
        bytes = [ 68, 0, 1, 0 ]
        instrument = model.instrument
        record = Array.new(68, 0)
        Binary.u16(record, 0, 5)
        record[8] = instrument[:midi_voice]
        record[9] = instrument[:midi_bank]
        record[10] = instrument[:banjo5]
        Binary.u16(record, 12, instrument[:capo])
        record[14] = instrument[:middle_c]
        record[15] = instrument[:clef]
        Binary.u16(record, 16, 0x0710)
        model.tuning.each_with_index { |pitch, index| record[20 + index] = 96 - pitch }
        record[32, 36] = Binary.text(model.title, 36)
        bytes + record
      end

      # One 32-byte record per range: first and last measure (1-based), then
      # an empty name.
      def self.reading_list_section(sequences)
        bytes = [ 32, 0, sequences.length, 0 ]
        sequences.each do |from, to|
          record = Array.new(32, 0)
          Binary.u16(record, 0, from)
          Binary.u16(record, 2, to)
          bytes.concat(record)
        end
        bytes
      end

      def self.texts_section(texts)
        bytes = [ texts.length & 0xFF, (texts.length >> 8) & 0xFF ]
        texts.each { |text| bytes.concat(text_record(text[:text])) }
        bytes
      end

      def self.text_record(value)
        encoded = value.to_s.encode(Encoding::UTF_8).bytes
        [ (encoded.length + 1) & 0xFF, ((encoded.length + 1) >> 8) & 0xFF, *encoded, 0 ]
      end

      def self.free_text_record(value)
        text_record(value.to_s)
      end

      def self.text_block(texts)
        [ 1, 0, 0 ] + (texts.empty? ? [] : texts_section(texts))
      end

      def self.chords_section(chords)
        bytes = [ 36, 0, chords.length & 0xFF, (chords.length >> 8) & 0xFF ]
        chords.each do |chord|
          record = Array.new(36, 0)
          record[0, 5] = Exporter.chord_values(chord)
          record[5, 9] = Array.new(9, 0xFF)
          record[14, 17] = Binary.text(chord[:name], 17)
          record[31] = chord[:first_fret].to_i.positive? ? chord[:first_fret].to_i.clamp(1, 255) : 1
          bytes.concat(record)
        end
        bytes
      end

      def self.content_section(model)
        measure_starts = [ 0 ]
        model.measures.each { |signature| measure_starts << measure_starts.last + signature[:numerator] * 64 / signature[:denominator] }
        continued = tied_continuations(model.notes)
        entries = model.notes.each_with_index.map { |note, index| [ logical_offset(note, measure_starts), note_record(note, tied_from_previous: continued.include?(index)) ] }
        model.texts.each_with_index { |text, index| entries << [ logical_offset(text, measure_starts), marker_record(0x39, index) ] }
        model.chords.each_with_index { |chord, index| entries << [ logical_offset(chord, measure_starts), marker_record(0x35, index) ] }
        entries.sort_by!(&:first)
        bytes = []
        first = entries.first&.first || 0
        Binary.u32(bytes, 0, first)
        entries.each_with_index do |(offset, record), index|
          bytes.concat(record)
          next_offset = entries[index + 1]&.first || 0xFFFFFFFF
          bytes.concat([ next_offset & 0xFF, (next_offset >> 8) & 0xFF, (next_offset >> 16) & 0xFF, (next_offset >> 24) & 0xFF ])
        end
        bytes
      end

      def self.logical_offset(item, measure_starts)
        absolute_units = measure_starts.fetch(item[:measure].to_i) + (item[:position].to_i * TEF3_UNITS_PER_QUARTER / TEF2_TICKS_PER_QUARTER)
        ((absolute_units * 5 + item[:string].to_i) << 3)
      end

      # Indexes of the notes a tie reaches: TablEdit marks the second note
      # of a tie, Playtab's model the first.
      def self.tied_continuations(notes)
        continued = Set.new
        notes.each_with_index.group_by { |note, _index| note[:string] }.each_value do |string_notes|
          string_notes.sort_by { |note, _index| [ note[:measure], note[:position] ] }.each_cons(2) do |(previous, _), (_, index)|
            continued << index if previous[:tie]
          end
        end
        continued
      end

      def self.note_record(note, tied_from_previous: false)
        marker = note[:fret] + 1
        marker |= 0x40 if note[:grace]
        duration = if note[:tuplet] && TUPLET_CODES[note[:duration].to_i]
          TUPLET_CODES[note[:duration].to_i]
        else
          Binary.duration_code(note[:duration], DURATION_CODES)
        end
        fingering = note[:fingering] == "T" ? 6 : note[:fingering].to_i.between?(1, 4) ? note[:fingering].to_i + 1 : 0
        dynamic = tied_from_previous ? 7 : [ note.fetch(:dynamic, DEFAULT_DYNAMIC).to_i, 6 ].min
        grace = note[:grace] ? ((note[:grace_effect].to_i & 0x07) << 5) | (note[:grace_fret].to_i & 0x1F) : 0
        effects = (note[:effect2].to_i & 0x0F) | ((note[:effect3].to_i & 0x0F) << 4)
        [ marker, duration | (dynamic << 5), note[:effect1].to_i & 0x0F, grace, effects, 0, fingering | ((note[:stroke].to_i & 0x07) << 5), 0 ]
      end

      def self.marker_record(marker, index)
        [ marker, index & 0xFF, (index >> 8) & 0xFF, 0, 0, 0, 0, 0 ]
      end
    end
  end
end
