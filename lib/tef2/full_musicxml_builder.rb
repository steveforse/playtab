# frozen_string_literal: true

require "nokogiri"

module Tef2
  # Builds partwise MusicXML from FullParser output
  # Matches alphaTab's expectations: two staves (tab + notation), identical content
  class FullMusicxmlBuilder
    TICKS_PER_QUARTER = 960
    DIVISIONS = 960
    TEF2_TICKS_PER_QUARTER = 256
    TEF2_TICKS_PER_BEAT = 256

    # Open G tuning: MIDI pitches for strings 1-5 (high to low)
    DEFAULT_TUNING = [ 62, 59, 55, 50, 67 ].freeze

    # Build MusicXML from FullParser output
    # @param parsed [Hash] output from FullParser.parse
    # @return [String] MusicXML document
    def self.build(parsed)
      measures = parsed[:measures]
      notes = parsed[:notes]
      annotations = parsed[:annotations]
      texts = parsed[:texts] || []
      chords = parsed[:chords] || []
      endings = parsed[:endings] || []
      tempo_changes = parsed[:tempo_changes] || []
      time_sig = parsed[:time_signature]
      tempo = parsed[:tempo]
      strings = parsed[:strings]
      tuning = parsed[:tuning] || DEFAULT_TUNING
      measure_signatures = parsed[:measure_signatures]
      lyrics_text = parsed[:lyrics_text].to_s

      builder = Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
        xml.send("score-partwise", version: "3.1") do
          write_lyrics_metadata(xml, lyrics_text) unless lyrics_text.empty?

          xml.send("part-list") do
            xml.send("score-part", id: "P1") do
              xml.send("part-name", "Banjo")
              xml.send("score-instrument", id: "P1-I1") do
                xml.send("instrument-name", "Banjo")
              end
              xml.send("midi-instrument", id: "P1-I1") do
                xml.send("midi-channel", 1)
                xml.send("midi-program", 105)  # Banjo
                xml.send("midi-bank", 0)
              end
            end
          end

          xml.part(id: "P1") do
            measures.times do |m|
              xml.measure(number: m + 1) do
                measure_time_sig = measure_signatures&.fetch(m, time_sig) || time_sig
                write_measure_attributes(xml, m, measure_time_sig, tempo, strings, tuning) if m == 0
                write_measure_time_signature(xml, measure_time_sig) if m.positive? && measure_signatures && measure_time_sig != measure_signatures[m - 1]
                write_tempo_direction(xml, tempo) if m == 0 && tempo > 0
                write_measure_barlines(xml, m, endings, location: "left")
                write_measure_notes(xml, m, notes, annotations, texts, chords, tempo_changes, strings, tuning, measure_time_sig)
                write_measure_barlines(xml, m, endings, location: "right")
              end
            end
          end
        end
      end
      builder.to_xml(save_with: Nokogiri::XML::Node::SaveOptions::FORMAT)
    end

    private

    def self.write_measure_attributes(xml, measure_index, time_sig, tempo, strings, tuning)
      xml.attributes do
        xml.divisions DIVISIONS
        xml.staves 2
        xml.key { xml.fifths 1 }  # G major
        write_time_signature(xml, time_sig)

        # Staff 1: Standard notation
        xml.clef(number: "1") { xml.sign "G"; xml.line 2; xml.send("clef-octave-change", -1) }
        # Staff 2: Tablature
        xml.clef(number: "2") { xml.sign "TAB"; xml.line 5 }
        xml.send("staff-details", number: "2", "print-object" => "yes") do
          xml.send("staff-type", "alternate")
          xml.send("staff-lines", strings)
          # MusicXML staff-tuning goes from low to high (string 5 to string 1).
          tuning.reverse.each_with_index do |pitch, index|
            xml.send("staff-tuning", line: index + 1) do
              xml.send("tuning-step", pitch_step(pitch))
              xml.send("tuning-octave", pitch_octave(pitch))
              xml.send("tuning-alter", pitch_alter(pitch))
            end
          end
        end
      end
    end

    def self.write_measure_time_signature(xml, time_sig)
      xml.attributes { write_time_signature(xml, time_sig) }
    end

    def self.write_measure_barlines(xml, measure_index, endings, location:)
      measure_endings = endings.select { |ending| ending[:measure] == measure_index }
      return if measure_endings.empty?

      if location == "left" && measure_endings.any? { |ending| ending[:is_open] }
        xml.barline(location: "left") { xml.repeat(direction: "forward") }
      end

      return unless location == "right"

      closing = measure_endings.find { |ending| ending[:is_close] }
      if closing
        number = closing[:ending_number].to_i
        xml.barline(location: "right") do
          if number >= 2
            xml.ending(number: number - 1, type: "stop")
            xml.repeat(direction: "backward", times: number - 1)
          else
            xml.repeat(direction: "backward")
          end
        end
      end

      measure_endings.select { |ending| !ending[:is_close] && ending[:ending_number].to_i.positive? }.each do |ending|
        xml.barline(location: "right") do
          xml.ending(number: ending[:ending_number], type: "start")
        end
      end
    end

    def self.write_time_signature(xml, time_sig)
      xml.time { xml.beats time_sig[:numerator]; xml.send("beat-type", time_sig[:denominator]) }
    end

    def self.write_tempo_direction(xml, tempo)
      xml.direction(placement: "above") do
        xml.send("direction-type") do
          xml.metronome do
            xml.send("beat-unit", "quarter")
            xml.send("per-minute", tempo)
          end
        end
      end
    end

    def self.write_measure_notes(xml, measure_index, notes, annotations, texts, chords, tempo_changes, strings, tuning, time_sig)
      # Filter notes for this measure
      measure_notes = notes.select { |n| n[:measure] == measure_index }
      measure_texts = texts.select { |text| text[:measure] == measure_index }
      measure_chords = chords.select { |chord| chord[:measure] == measure_index }
      measure_tempos = tempo_changes.select { |change| change[:measure] == measure_index }
      return if measure_notes.empty? && measure_texts.empty? && measure_chords.empty? && measure_tempos.empty?

      # Build technique pairs from ALL notes (techniques can span measures)
      all_notes_by_string = notes.group_by { |n| n[:string] }
      technique_pairs = build_technique_pairs(all_notes_by_string)
      slide_pairs = build_slide_pairs(all_notes_by_string)
      tie_pairs = build_tie_pairs(all_notes_by_string)

      # Sort notes by position
      sorted_notes = measure_notes.sort_by { |n| n[:position] }

      # Track cursor for rest insertion (in TEF2 ticks)
      ticks_per_measure = tef2_ticks_per_measure(time_sig)
      cursor = 0
      metadata_positions = (measure_texts + measure_chords + measure_tempos).map { |item| item[:position].to_i }.uniq.sort
      metadata_index = 0

      # === STAFF 1: Standard notation ===
      sorted_notes.each do |note|
        tef2_pos = note[:position]
        tef2_dur = note[:tef2_duration]

        while metadata_index < metadata_positions.length && metadata_positions[metadata_index] <= tef2_pos
          write_measure_metadata(
            xml,
            measure_texts.select { |text| text[:position].to_i == metadata_positions[metadata_index] },
            measure_chords.select { |chord| chord[:position].to_i == metadata_positions[metadata_index] },
            measure_tempos.select { |tempo_change| tempo_change[:position].to_i == metadata_positions[metadata_index] },
            staff: 1, position: metadata_positions[metadata_index]
          )
          metadata_index += 1
        end

        # Insert rest if gap
        if tef2_pos > cursor
          rest_dur_tef2 = tef2_pos - cursor
          rest_dur_xml = tef2_to_xml_duration(rest_dur_tef2)
          write_rest(xml, rest_dur_xml, staff: 1)
        elsif tef2_pos < cursor && !note[:is_chord]
          xml.backup { xml.duration tef2_to_xml_duration(cursor - tef2_pos) }
        end

        write_note_notation(xml, note, technique_pairs, slide_pairs, tie_pairs, tuning)
        cursor = tef2_pos + tef2_dur
      end

      while metadata_index < metadata_positions.length
        write_measure_metadata(
          xml,
          measure_texts.select { |text| text[:position].to_i == metadata_positions[metadata_index] },
          measure_chords.select { |chord| chord[:position].to_i == metadata_positions[metadata_index] },
          measure_tempos.select { |tempo_change| tempo_change[:position].to_i == metadata_positions[metadata_index] },
          staff: 1, position: metadata_positions[metadata_index]
        )
        metadata_index += 1
      end

      # End-of-measure rest for staff 1
      if cursor < ticks_per_measure
        rest_dur_tef2 = ticks_per_measure - cursor
        rest_dur_xml = tef2_to_xml_duration(rest_dur_tef2)
        write_rest(xml, rest_dur_xml, staff: 1)
      end

      # === STAFF 2: Tablature (use backup to go back to measure start) ===
      xml.backup { xml.duration ticks_per_measure * DIVISIONS / TEF2_TICKS_PER_QUARTER }
      cursor = 0
      metadata_index = 0

      sorted_notes.each do |note|
        tef2_pos = note[:position]
        tef2_dur = note[:tef2_duration]

        while metadata_index < metadata_positions.length && metadata_positions[metadata_index] <= tef2_pos
          write_measure_metadata(
            xml,
            measure_texts.select { |text| text[:position].to_i == metadata_positions[metadata_index] },
            measure_chords.select { |chord| chord[:position].to_i == metadata_positions[metadata_index] },
            measure_tempos.select { |tempo_change| tempo_change[:position].to_i == metadata_positions[metadata_index] },
            staff: 2, position: metadata_positions[metadata_index]
          )
          metadata_index += 1
        end

        # Insert rest if gap
        if tef2_pos > cursor
          rest_dur_tef2 = tef2_pos - cursor
          rest_dur_xml = tef2_to_xml_duration(rest_dur_tef2)
          write_rest(xml, rest_dur_xml, staff: 2)
        elsif tef2_pos < cursor && !note[:is_chord]
          xml.backup { xml.duration tef2_to_xml_duration(cursor - tef2_pos) }
        end

        write_note_tab(xml, note, technique_pairs, slide_pairs, tie_pairs, annotations, strings, tuning)
        cursor = tef2_pos + tef2_dur
      end

      while metadata_index < metadata_positions.length
        write_measure_metadata(
          xml,
          measure_texts.select { |text| text[:position].to_i == metadata_positions[metadata_index] },
          measure_chords.select { |chord| chord[:position].to_i == metadata_positions[metadata_index] },
          measure_tempos.select { |tempo_change| tempo_change[:position].to_i == metadata_positions[metadata_index] },
          staff: 2, position: metadata_positions[metadata_index]
        )
        metadata_index += 1
      end

      # End-of-measure rest for staff 2
      if cursor < ticks_per_measure
        rest_dur_tef2 = ticks_per_measure - cursor
        rest_dur_xml = tef2_to_xml_duration(rest_dur_tef2)
        write_rest(xml, rest_dur_xml, staff: 2)
      end
    end

    def self.write_measure_metadata(xml, texts, chords, tempo_changes, staff:, position: 0)
      tempo_changes.each { |tempo_change| write_tempo_direction(xml, tempo_change[:tempo]) }
      text_values = texts.map { |text| text[:text].to_s.strip }.reject(&:empty?)
      unless text_values.empty?
        direction_attributes = { placement: "above" }
        if texts.length == 1 && texts.first[:string].to_i.between?(0, 4)
          direction_attributes["data-playtab-string"] = texts.first[:string].to_i
        end
        xml.direction(direction_attributes) do
          xml.send("direction-type") { xml.words(text_values.join(" / ")) }
          xml.offset tef2_to_xml_duration(position) if position.to_i.positive?
          xml.staff staff
        end
      end

      chords.each { |chord| write_harmony(xml, chord, staff:, position:) }
    end

    def self.write_harmony(xml, chord, staff:, position: 0)
      name = chord[:name].to_s.strip
      return if name.empty?

      match = name.match(/\A([A-Ga-g])([#b♯♭]?)(.*)\z/)
      root = match ? match[1].upcase : "C"
      accidental = match ? match[2] : ""
      suffix = match ? match[3] : name
      alter = { "#" => 1, "♯" => 1, "b" => -1, "♭" => -1 }[accidental]

      harmony_attributes = { placement: "above" }
      strings = chord[:strings].to_a.first(5)
      if strings.length == 5
        harmony_attributes["data-playtab-strings"] = strings.map { |value| value.to_i }.join(",")
      end
      if chord[:first_fret].to_i.positive?
        harmony_attributes["data-playtab-first-fret"] = chord[:first_fret].to_i
      end
      if chord[:string].to_i.between?(0, 4)
        harmony_attributes["data-playtab-string"] = chord[:string].to_i
      end
      xml.harmony(harmony_attributes) do
        xml.root do
          xml.send("root-step", root)
          xml.send("root-alter", alter) if alter
        end
        xml.kind(text: suffix) { xml.text "major" }
        xml.offset tef2_to_xml_duration(position) if position.to_i.positive?
        xml.staff staff
      end
    end

    def self.tef2_to_xml_duration(tef2_ticks)
      # TEF2: 256 ticks per quarter
      # XML: 960 divisions per quarter
      (tef2_ticks * DIVISIONS / TEF2_TICKS_PER_QUARTER).round
    end

    def self.tef2_ticks_per_measure(time_sig)
      TEF2_TICKS_PER_QUARTER * time_sig[:numerator] * 4 / time_sig[:denominator]
    end

    def self.write_rest(xml, duration, staff: 1)
      xml.note do
        xml.rest
        xml.duration duration
        xml.voice 1
        xml.staff staff
      end
    end

    def self.write_note_notation(xml, note, technique_pairs, slide_pairs, tie_pairs, tuning)
      string = note[:string]  # 0-based, 0 = highest
      fret = note[:fret]
      tef2_dur = note[:tef2_duration]
      component_idx = note[:component_index]
      is_chord = note[:is_chord]

      xml_duration = tef2_to_xml_duration(tef2_dur)

      # Compute pitch for notation staff (staff 1)
      string_pitch = tuning[string]
      note_pitch = string_pitch + fret

      pair_key = [ string, component_idx ]
      pair = technique_pairs[pair_key]
      slide = slide_pairs[pair_key]
      tie = tie_pairs[pair_key]
      technique_number = pair ? pair[:number] : nil

      write_grace_note(xml, note, tuning, staff: 1) if note[:grace]

      xml.note do
        xml.chord if is_chord
        xml.pitch do
          xml.step pitch_step(note_pitch)
          xml.octave pitch_octave(note_pitch)
          xml.alter pitch_alter(note_pitch)
        end

        xml.duration xml_duration
        xml.voice(note[:voice].to_i.positive? ? note[:voice] : 1)
        xml.type note_type(xml_duration)
        write_time_modification(xml, note)
        xml.staff 1
        write_notehead(xml, note)

        write_note_notations(xml, note, pair, slide, tie, technique_number, tab: false)
      end
    end

    def self.write_note_tab(xml, note, technique_pairs, slide_pairs, tie_pairs, annotations, strings, tuning)
      string = note[:string]  # 0-based, 0 = highest
      fret = note[:fret]
      tef2_dur = note[:tef2_duration]
      component_idx = note[:component_index]
      is_chord = note[:is_chord]

      xml_duration = tef2_to_xml_duration(tef2_dur)

      pair_key = [ string, component_idx ]
      pair = technique_pairs[pair_key]
      slide = slide_pairs[pair_key]
      tie = tie_pairs[pair_key]
      technique_number = pair ? pair[:number] : nil

      write_grace_note(xml, note, tuning, staff: 2) if note[:grace]

      xml.note do
        xml.chord if is_chord
        # Tablature staff: pitch is not used, but some importers expect it
        # Use the same pitch as notation staff
        string_pitch = tuning[string]
        note_pitch = string_pitch + fret
        xml.pitch do
          xml.step pitch_step(note_pitch)
          xml.octave pitch_octave(note_pitch)
          xml.alter pitch_alter(note_pitch)
        end

        xml.duration xml_duration
        xml.voice(note[:voice].to_i.positive? ? note[:voice] : 1)
        xml.type note_type(xml_duration)
        write_time_modification(xml, note)
        xml.stem "none"  # Tab stems are hidden
        xml.staff 2
        write_notehead(xml, note)

        write_note_notations(xml, note, pair, slide, tie, technique_number, tab: true, annotations: annotations)
      end
    end

    def self.write_grace_note(xml, note, tuning, staff:)
      string = note[:string]
      fret = note[:grace_note_fret].to_i
      note_pitch = tuning[string] + fret

      xml.note do
        xml.grace(slash: "yes")
        xml.pitch do
          xml.step pitch_step(note_pitch)
          xml.octave pitch_octave(note_pitch)
          xml.alter pitch_alter(note_pitch)
        end
        xml.voice 1
        xml.staff staff
        xml.notations do
          xml.technical do
            xml.string(string + 1)
            xml.fret fret
            if note[:grace_note_effect].to_i.positive?
              xml.send("other-technical") { xml.text "TEF grace effect #{note[:grace_note_effect]}" }
            end
          end
        end
      end
    end

    def self.write_time_modification(xml, note)
      return unless note[:tuplet]

      xml.send("time-modification") do
        xml.send("actual-notes", 3)
        xml.send("normal-notes", 2)
      end
    end

    def self.write_note_notations(xml, note, pair, slide, tie, technique_number, tab:, annotations: {})
      xml.notations do
        xml.tied(type: tie[:is_start] ? "start" : "stop", number: tie[:number]) if tie
        if note[:effect1].to_i == 14 || note[:effect2].to_i >> 4 == 3 || note[:effect3].to_i == 3
          xml.arpeggiate(direction: "down")
        end
        if note[:effect1].to_i == 10
          xml.ornaments { xml.send("wavy-line") }
        elsif note[:effect1].to_i == 11
          xml.ornaments { xml.tremolo 1 }
        end
        if note[:effect2].to_i & 0x0F == 7
          xml.articulations { xml.staccato }
        end
        xml.technical do
          if tab
            xml.string(note[:string] + 1)
            xml.fret note[:fret]
          end

          if pair
            tag = pair[:kind]
            type = pair[:is_start] ? "start" : "stop"
            xml.send(tag, type: type, number: technique_number)
          end
          if slide
            type = slide[:is_start] ? "start" : "stop"
            xml.slide(type: type, number: slide[:number])
          end

          write_bend_technical(xml, note)
          write_effect_technical(xml, note)
          write_modern_fingerings(xml, note) if tab

          # TEF2 stores these as annotation payloads rather than as fret
          # extensions.  Known codes become visible fingerings; other codes
          # remain explicit technical metadata.
          if tab && (ann = annotations[note[:index]])
            if [ 2, 4 ].include?(ann)
              xml.fingering(enclosure: "circle") { xml.text({ 2 => 1, 4 => 3 }.fetch(ann)) }
            else
              xml.send("other-technical") { xml.text "TEF fingering code #{ann}" }
            end
          end
        end
      end
    end

    def self.write_notehead(xml, note)
      if note[:effect2].to_i & 0x0F == 4
        xml.notehead(parentheses: "yes") { xml.text "normal" }
      elsif note[:effect1].to_i == 15 || note[:effect3].to_i == 10
        xml.notehead { xml.text "x" }
      end
    end

    def self.write_effect_technical(xml, note)
      effect1 = note[:effect1].to_i
      effect2 = note[:effect2].to_i
      effect3 = note[:effect3].to_i

      case effect1
      when 6
        xml.harmonic { xml.natural }
      when 7
        xml.harmonic { xml.artificial }
      when 9
        xml.method_missing(:tap)
      end

      case effect3
      when 6
        xml.harmonic { xml.natural }
      when 7
        xml.harmonic { xml.artificial }
      end

      low = effect2 & 0x0F
      high = (effect2 >> 4) & 0x0F
      metadata = []
      metadata << "TEF let ring" if low == 1 || high == 8 || effect3 == 8
      metadata << "TEF slap" if low == 2
      metadata << "TEF fade in" if low == 8
      metadata << "TEF fade out" if low == 9
      metadata << "TEF grace effect #{note[:grace_note_effect]}" if note[:grace_note_effect].to_i.positive? && note[:grace]
      metadata << "TEF effect1 #{effect1}" unless (0..15).cover?(effect1)
      metadata << "TEF effect2 #{low}" unless [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15 ].include?(low)
      metadata << "TEF effect3 #{effect3}" if note[:effect3] && !(0..11).cover?(effect3)
      metadata.each { |value| xml.send("other-technical") { xml.text value } }
    end

    # TEF2 stores its optional "LYRICS & CHORDS" page as free text rather
    # than as note-aligned lyric events. Keep it in standard MusicXML metadata
    # so the frontend can render it as a separate section below the score.
    def self.write_lyrics_metadata(xml, lyrics_text)
      xml.identification do
        xml.miscellaneous do
          xml.send("miscellaneous-field", name: "playtab-lyrics") { xml.text lyrics_text.delete("\0") }
        end
      end
    end

    def self.write_bend_technical(xml, note)
      effect = note[:effect1].to_i
      return unless [ 4, 12, 13 ].include?(effect)

      xml.bend do
        # TablEdit effect 4 is the quarter bend shown in the Cluck Ol' Hen
        # source PDF. Effects 12/13 are the standard whole-tone bend and
        # bend-release values used by other TEF3 files.
        xml.send("bend-alter", effect == 4 ? 0.5 : 2)
        xml.release if effect == 13
      end
    end

    def self.write_modern_fingerings(xml, note)
      fingerings = Array(note[:fingerings]).dup
      fingerings << "T" if note[:stroke].to_i == 1 && !fingerings.include?("T")
      return if fingerings.empty?

      fingerings.each do |fingering|
        if fingering == "T"
          xml.send("other-technical", "TEF fingering T")
        else
          xml.fingering(enclosure: "circle") { xml.text fingering }
        end
      end
    end

    TICKS_PER_MEASURE = 1024  # TEF2 ticks per measure (256 * 4)

    def self.build_technique_pairs(notes_by_string)
      pairs = {}

      notes_by_string.each do |string, string_notes|
        # Sort by absolute tick position
        ordered_notes = string_notes.sort_by { |n| n[:absolute_position] || (n[:measure] * TICKS_PER_MEASURE + n[:position]) }

        # For each technique note, find the next note on the same string
        ordered_notes.each_with_index do |note, i|
          effect = legato_effect(note)
          next unless effect

          # Find destination note (next note on same string with tef2_duration > 0)
          dest = ordered_notes[(i + 1)..].find { |n| n[:tef2_duration] > 0 }
          next unless dest

          # TEF2 uses both effect1 values for the same legato marker.  The
          # direction is determined by the destination fret, as TuxGuitar
          # does when it rewrites its shared hammer flag.
          kind = if note[:modern_tabledit] && [ 1, 2 ].include?(note[:effect1].to_i)
            note[:effect1].to_i == 1 ? "hammer-on" : "pull-off"
          elsif note[:modern_tabledit] && [ 1, 2 ].include?(note[:effect3].to_i)
            note[:effect3].to_i == 1 ? "hammer-on" : "pull-off"
          else
            dest[:fret] > note[:fret] ? "hammer-on" : "pull-off"
          end
          pair_num = note[:component_index]

          pairs[[ string, note[:component_index] ]] = {
            kind: kind,
            number: pair_num,
            is_start: true
          }
          pairs[[ string, dest[:component_index] ]] = {
            kind: kind,
            number: pair_num,
            is_start: false
          }
        end
      end

      pairs
    end

    def self.legato_effect(note)
      [ note[:technique], note[:effect1], note[:effect3], note[:effect2].to_i >> 4 ].find { |value| [ 1, 2 ].include?(value.to_i) }
    end

    def self.build_slide_pairs(notes_by_string)
      pairs = {}

      notes_by_string.each do |string, string_notes|
        ordered_notes = string_notes.sort_by { |n| n[:absolute_position] || (n[:measure] * TICKS_PER_MEASURE + n[:position]) }
        ordered_notes.each_with_index do |note, index|
          next unless note[:effect1].to_i == 3

          destination = ordered_notes[(index + 1)..].find { |candidate| candidate[:tef2_duration].to_i.positive? }
          next unless destination

          number = note[:component_index]
          pairs[[ string, note[:component_index] ]] = { number: number, is_start: true }
          pairs[[ string, destination[:component_index] ]] = { number: number, is_start: false }
        end
      end

      pairs
    end

    def self.build_tie_pairs(notes_by_string)
      pairs = {}

      notes_by_string.each do |string, string_notes|
        ordered_notes = string_notes.sort_by { |n| n[:absolute_position] || (n[:measure] * TICKS_PER_MEASURE + n[:position]) }
        ordered_notes.each_with_index do |note, index|
          next unless note[:tie]

          destination = ordered_notes[(index + 1)..].find { |candidate| candidate[:tef2_duration].to_i.positive? }
          next unless destination

          number = note[:component_index]
          pairs[[ string, note[:component_index] ]] = { number: number, is_start: true }
          pairs[[ string, destination[:component_index] ]] = { number: number, is_start: false }
        end
      end

      pairs
    end

    PITCH_COMPONENTS = [
      [ "C", 0 ], [ "D", -1 ], [ "D", 0 ], [ "E", -1 ],
      [ "E", 0 ], [ "F", 0 ], [ "G", -1 ], [ "G", 0 ],
      [ "A", -1 ], [ "A", 0 ], [ "B", -1 ], [ "B", 0 ]
    ].freeze

    def self.pitch_step(midi_pitch)
      PITCH_COMPONENTS[midi_pitch % 12][0]
    end

    def self.pitch_alter(midi_pitch)
      PITCH_COMPONENTS[midi_pitch % 12][1]
    end

    def self.pitch_octave(midi_pitch)
      # MusicXML numbers middle C (MIDI 60) as octave 4.
      (midi_pitch / 12) - 1
    end

    def self.note_type(duration_ticks)
      case duration_ticks
      when DIVISIONS * 4 then "whole"
      when DIVISIONS * 2 then "half"
      when DIVISIONS then "quarter"
      when DIVISIONS / 2 then "eighth"
      when DIVISIONS / 4 then "16th"
      when DIVISIONS / 8 then "32nd"
      else "quarter"
      end
    end
  end
end
