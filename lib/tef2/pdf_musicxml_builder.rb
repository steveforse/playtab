# frozen_string_literal: true

require "nokogiri"

module Tef2
  class PdfMusicxmlBuilder
    DIVISIONS = 960
    MEASURE_TICKS = 3840
    PDF_MEASURE_TICKS = 1024
    DEFAULT_TUNING = [ 67, 50, 55, 59, 62 ].freeze
    MAX_TECHNIQUE_MEASURE_GAP = 3
    PITCHES = { "C" => 0, "D" => 2, "E" => 4, "F" => 5, "G" => 7, "A" => 9, "B" => 11 }.freeze

    def self.build(score)
      new.build(score)
    end

    def build(score)
      builder = Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
        xml.send("score-partwise", version: "3.1") do
          xml.identification do
            xml.miscellaneous do
              if score[:lyrics]
                xml.send("miscellaneous-field", score[:lyrics], name: "playtab-lyrics")
              end
            end
          end
          xml.work do
            xml.send("work-title", score.fetch(:title, "Imported PDF"))
          end
          write_credit(xml, "subtitle", score[:subtitle])
          write_credit(xml, "arranger", score[:arranger])
          xml.send("part-list") do
            xml.send("score-part", id: "P1") do
              xml.send("part-name", "Banjo")
              xml.send("score-instrument", id: "P1-I1") { xml.send("instrument-name", "Banjo") }
              xml.send("midi-instrument", id: "P1-I1") do
                xml.send("midi-channel", "1")
                xml.send("midi-program", "105")
              end
            end
          end

          xml.part(id: "P1") do
            write_measures(xml, score)
          end
        end
      end
      builder.to_xml
    end

    private

    def write_measures(xml, score)
      tuning = parse_tuning(score[:tuning_label].to_s)
      time_signature = score[:time_signature] || { numerator: 4, denominator: 4 }
      measure_signatures = score[:measure_signatures].to_a
      notes = score[:notes] || []
      technique_map = techniques_by_note(score, notes)
      rake_map = rakes_by_note(score, notes)
      fingering_map = fingerings_by_note(score, notes)
      sections = metadata_by_measure(score[:sections] || [])
      chords = metadata_by_measure(score[:chords] || [])
      rests = metadata_by_measure(score[:rests] || [])
      chord_diagrams = (score[:chord_diagrams] || []).to_h { |diagram| [ diagram[:name].to_s, diagram ] }

      previous_measure_signature = nil
      score.fetch(:measures, 0).times do |measure_index|
        measure_signature = measure_signatures[measure_index] || time_signature
        measure_ticks = xml_measure_ticks(measure_signature)
        pdf_measure_ticks = pdf_measure_ticks(measure_signature)
        xml.measure(number: (measure_index + 1).to_s) do
          if measure_index.zero?
            write_attributes(xml, measure_signature, tuning)
            write_tempo(xml, score[:tempo]) if score[:tempo]
          elsif measure_signature != previous_measure_signature
            xml.attributes { write_time_signature(xml, measure_signature) }
          end

          write_repeat_barlines(xml, score[:repeats] || [], score[:endings] || [], measure_index)

          sections.fetch(measure_index, []).each do |section|
            write_words(xml, section[:text].to_s, section[:position].to_i, pdf_measure_ticks, measure_ticks)
          end
          chords.fetch(measure_index, []).each do |chord|
            write_harmony(xml, chord[:name].to_s, chord[:position].to_i, pdf_measure_ticks, measure_ticks,
                          diagram: chord_diagrams[chord[:name].to_s])
          end

          measure_notes = notes.select { |note| note[:measure] == measure_index }
          events = measure_notes.each_with_object({}) { |note, result| (result[note[:position]] ||= []) << note }
          rest_positions = rests.fetch(measure_index, []).map { |rest| rest[:position].to_i }
          cursor = 0
          positions = (events.keys + rest_positions).uniq.sort
          positions.each_with_index do |position, event_index|
            target = pdf_position_to_xml(position, pdf_measure_ticks, measure_ticks)
            write_rest(xml, target - cursor) if target > cursor
            next_target = event_index + 1 < positions.length ? pdf_position_to_xml(positions[event_index + 1], pdf_measure_ticks, measure_ticks) : measure_ticks
            duration = next_target > target ? [ 120, next_target - target ].max : 120
            duration = [ duration, measure_ticks - target ].min
            if events[position]
              events[position].sort_by { |note| note[:string] }.each_with_index do |note, note_index|
                write_note(
                  xml,
                  note,
                  duration,
                  tuning,
                  note_index.positive?,
                  technique_map[note_key(note)],
                  fingering_map[note_key(note)],
                  rake_map[note_key(note)]
                )
              end
            else
              write_rest(xml, duration)
            end
            cursor = target + duration
          end
          write_rest(xml, measure_ticks - cursor) if cursor < measure_ticks
        end
        previous_measure_signature = measure_signature
      end
    end

    def write_attributes(xml, time_signature, tuning)
      xml.attributes do
        xml.divisions(DIVISIONS.to_s)
        write_time_signature(xml, time_signature)
        xml.clef do
          xml.sign("TAB")
          xml.line("5")
        end
        xml.send("staff-details") do
          xml.send("staff-lines", "5")
          tuning.each_with_index do |midi, index|
            xml.send("staff-tuning", line: (index + 1).to_s) do
              step, alter, octave = midi_pitch(midi)
              xml.send("tuning-step", step)
              xml.send("tuning-alter", alter.to_s) if alter != 0
              xml.send("tuning-octave", octave.to_s)
            end
          end
        end
      end
    end

    def write_time_signature(xml, time_signature)
      xml.time do
        xml.beats(time_signature.fetch(:numerator, 4).to_s)
        xml.send("beat-type", time_signature.fetch(:denominator, 4).to_s)
      end
    end

    def write_tempo(xml, tempo)
      xml.direction(placement: "above") do
        xml.send("direction-type") do
          xml.metronome do
            xml.send("beat-unit", "quarter")
            xml.send("per-minute", tempo.to_s)
          end
        end
      end
    end

    def write_credit(xml, type, value)
      text = value.to_s.strip
      return if text.empty?

      xml.credit(page: "1") do
        xml.send("credit-type", type)
        xml.send("credit-words", text)
      end
    end

    def write_words(xml, value, position, pdf_measure_ticks, measure_ticks)
      xml.direction(placement: "above") do
        xml.send("direction-type") { xml.words(value) }
        xml.offset(pdf_position_to_xml(position, pdf_measure_ticks, measure_ticks).to_s) if position.positive?
      end
    end

    def write_harmony(xml, value, position, pdf_measure_ticks, measure_ticks, diagram: nil)
      match = value.strip.match(/\A([A-G])([#b]?)(?:\s*(.*))?\z/)
      return unless match

      harmony_attributes = {}
      if diagram && diagram[:strings].to_a.length == 5
        harmony_attributes["data-playtab-strings"] = diagram[:strings].map { |fret| fret.to_i }.join(",")
        harmony_attributes["data-playtab-first-fret"] = diagram[:first_fret].to_i if diagram[:first_fret].to_i.positive?
      end
      xml.harmony(harmony_attributes) do
        xml.root do
          xml.send("root-step", match[1])
          xml.send("root-alter", match[2] == "#" ? "1" : "-1") unless match[2].empty?
        end
        xml.kind(chord_kind(match[3]))
        xml.offset(pdf_position_to_xml(position, pdf_measure_ticks, measure_ticks).to_s) if position.positive?
      end
    end

    def write_repeat_barlines(xml, repeats, endings, measure_index)
      starts = endings.select do |ending|
        ending[:measure].to_i == measure_index && ending.fetch(:type, "start") == "start"
      end
      stops = endings.select { |ending| ending[:measure].to_i == measure_index && ending[:type] == "stop" }
      starts.each do |ending|
        stops << ending.merge(type: "stop", location: "right") if ending.fetch(:location, "left") == "left"
      end

      [ "left", "right" ].each do |location|
        location_repeats = repeats.select do |repeat|
          repeat[:measure].to_i == measure_index && repeat.fetch(:location) == location
        end
        location_endings = (starts + stops).select { |ending| ending.fetch(:location, location) == location }
        location_endings = location_endings.uniq { |ending| [ ending[:number].to_s, ending[:type].to_s, location ] }
        next if location_repeats.empty? && location_endings.empty?

        xml.barline(location: location) do
          location_endings.each do |ending|
            xml.ending(number: ending.fetch(:number).to_s, type: ending.fetch(:type))
          end
          location_repeats.each { |repeat| xml.repeat(direction: repeat.fetch(:direction)) }
        end
      end
    end

    def chord_kind(value)
      suffix = value.to_s.strip.downcase
      return "minor" if %w[min m minor].include?(suffix)
      return "major" if suffix.empty? || %w[maj major].include?(suffix)
      return "dominant" if suffix == "7"
      return "major-seventh" if suffix == "maj7"
      return "minor-seventh" if %w[min7 m7 minor7].include?(suffix)
      return "diminished" if suffix == "dim"
      return "diminished-seventh" if suffix == "dim7"
      return "augmented" if suffix == "aug"
      return "augmented-seventh" if suffix == "aug7"
      return "suspended-second" if suffix == "sus2"
      return "suspended-fourth" if %w[sus sus4].include?(suffix)

      "other"
    end

    def write_rest(xml, duration)
      xml.note do
        xml.rest
        write_duration(xml, duration)
      end
    end

    def write_note(xml, source, duration, tuning, chord, techniques, fingering, rake)
      xml.note do
        xml.chord if chord
        xml.pitch do
          step, alter, octave = midi_pitch(tuning.fetch(source[:string]) + source[:fret])
          xml.step(step)
          xml.alter(alter.to_s) unless alter.zero?
          xml.octave(octave.to_s)
        end
        write_duration(xml, duration)
        if source[:ghost]
          xml.notehead(parentheses: "yes") { xml.text "normal" }
        elsif source[:dead]
          xml.notehead("x")
        end
        xml.notations do
          xml.arpeggiate(direction: "down") if rake
          xml.technical do
            xml.string((source[:string] + 1).to_s)
            xml.fret(source[:fret].to_s)
            if fingering
              if fingering == "T"
                xml.send("other-technical", "TEF fingering T")
              else
                xml.fingering(fingering, enclosure: "circle")
              end
            end
            techniques.to_a.each do |technique|
              attributes = { type: technique[:marker_type] }
              xml.send(technique[:xml_type], technique[:marker_type] == "start" ? technique[:label] : nil, **attributes)
            end
            xml.send("other-technical", "TEF rake") if rake
          end
        end
      end
    end

    def write_duration(xml, duration)
      xml.duration(duration.to_s)
      type, dots = duration_components(duration)
      xml.type(type)
      dots.times { xml.dot }
    end

    def techniques_by_note(score, notes)
      result = {}
      (score[:techniques] || []).each do |technique|
        next unless %w[hammer-on pull-off slide bend].include?(technique[:type])

        key = [ technique[:measure], technique[:position], technique[:string] ]
        current = notes.find { |note| note_location_key(note) == key }
        next unless current

        following = notes.find do |note|
          note[:string] == current[:string] && ([ note[:measure], note[:position] ] <=> [ current[:measure], current[:position] ]) == 1
        end
        next unless following
        next if following[:measure] - current[:measure] > MAX_TECHNIQUE_MEASURE_GAP
        next if technique[:type] == "hammer-on" && current[:fret] >= following[:fret]
        next if technique[:type] == "pull-off" && current[:fret] <= following[:fret]

        xml_type = technique[:type]
        add_technique(result, note_key(current), xml_type: xml_type, marker_type: "start", label: technique.fetch(:label, technique[:type]))
        add_technique(result, note_key(following), xml_type: xml_type, marker_type: "stop", label: "")
      end
      result
    end

    def rakes_by_note(score, notes)
      result = {}
      (score[:techniques] || []).select { |item| item[:type] == "rake" }.each do |item|
        note = notes.find { |candidate| note_location_key(candidate) == note_location_key(item) }
        result[note_key(note)] = true if note
      end
      result
    end

    def fingerings_by_note(score, notes)
      result = {}
      (score[:fingerings] || []).each do |item|
        note = notes.find { |candidate| note_location_key(candidate) == note_location_key(item) }
        result[note_key(note)] = item[:value] if note
      end
      (score[:techniques] || []).select { |item| item[:type] == "thumb" }.each do |item|
        note = notes.find { |candidate| note_location_key(candidate) == note_location_key(item) }
        result[note_key(note)] = "T" if note
      end
      result
    end

    def add_technique(result, key, technique)
      result[key] ||= []
      result[key] << technique unless result[key].include?(technique)
    end

    def metadata_by_measure(items)
      items.each_with_object({}) { |item, result| (result[item.fetch(:measure, 0)] ||= []) << item }
    end

    def note_key(note)
      [ note[:measure], note[:position], note[:string], note[:fret], note[:dead], note[:ghost] ]
    end

    def note_location_key(note)
      [ note[:measure], note[:position], note[:string] ]
    end

    def pdf_position_to_xml(position, pdf_measure_ticks, measure_ticks)
      [ 0, [ measure_ticks, (position * measure_ticks.to_f / pdf_measure_ticks).round ].min ].max
    end

    def xml_measure_ticks(time_signature)
      (MEASURE_TICKS * time_signature.fetch(:numerator, 4).to_f / time_signature.fetch(:denominator, 4)).round
    end

    def pdf_measure_ticks(time_signature)
      (PDF_MEASURE_TICKS * time_signature.fetch(:numerator, 4).to_f / time_signature.fetch(:denominator, 4)).round
    end

    def duration_type(duration)
      duration_components(duration).first
    end

    def duration_components(duration)
      type = {
        120 => "32nd",
        240 => "16th",
        360 => "16th",
        480 => "eighth",
        720 => "eighth",
        960 => "quarter",
        1440 => "quarter",
        1920 => "half",
        2880 => "half",
        3840 => "whole"
      }.fetch(duration, "eighth")
      [ type, [ 360, 720, 1440, 2880 ].include?(duration) ? 1 : 0 ]
    end

    def parse_tuning(label)
      tokens = label.scan(/[A-Ga-g](?:#|b|♭)?/)
      return DEFAULT_TUNING.dup unless tokens.length == 5

      [ 4, 3, 3, 4, 4 ].each_with_index.map { |octave, index| pitch_from_token(tokens[index], octave) }
    end

    def pitch_from_token(token, octave)
      step = token[0].upcase
      alter = token[1] == "#" ? 1 : [ "b", "♭" ].include?(token[1]) ? -1 : 0
      (octave + 1) * 12 + PITCHES.fetch(step) + alter
    end

    def midi_pitch(midi)
      names = [ [ "C", 0 ], [ "C", 1 ], [ "D", 0 ], [ "D", 1 ], [ "E", 0 ], [ "F", 0 ], [ "F", 1 ], [ "G", 0 ], [ "G", 1 ], [ "A", 0 ], [ "A", 1 ], [ "B", 0 ] ]
      step, alter = names.fetch(midi % 12)
      [ step, alter, midi / 12 - 1 ]
    end
  end
end
