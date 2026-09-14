# frozen_string_literal: true

require "nokogiri"

module Tef2
  # Builds partwise MusicXML from TEF2 timeline
  # Output matches alphaTab's expectations: two staves (tab + notation), identical content
  class MusicXmlBuilder
    TICKS_PER_QUARTER = 960
    DIVISIONS = 960
    BEATS_PER_MEASURE = 4

    # Open G tuning: MIDI pitches for strings 1-5 (high to low)
    # String 1 (high D): D4 = 62
    # String 2: B3 = 59
    # String 3: G3 = 55
    # String 4: D3 = 50
    # String 5 (low G): G4 = 67
    DEFAULT_TUNING = [ 62, 59, 55, 50, 67 ].freeze

    # Build MusicXML string
    # @param measures [Integer] number of measures
    # @param timeline [Array<Hash>] timeline from Timeline.build
    # @param annotations [Hash<Integer, Integer>] component_index => annotation_code
    # @param tuning [Array<Integer>] MIDI pitches for strings 1-5 (high to low)
    # @return [String] MusicXML document
    def self.build(measures:, timeline:, annotations:, tuning: DEFAULT_TUNING)
      builder = Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
        xml.send("score-partwise", version: "3.1") do
          xml.send("part-list") do
            xml.send("score-part", id: "P1") do
              xml.send("part-name", "Banjo")
            end
          end

          xml.part(id: "P1") do
            measures.times do |m|
              xml.measure(number: m + 1) do
                write_measure_attributes(xml, m, tuning) if m == 0
                write_measure_notes(xml, m, timeline, annotations, tuning)
              end
            end
          end
        end
      end
      builder.to_xml(save_with: Nokogiri::XML::Node::SaveOptions::FORMAT)
    end

    private

    def self.write_measure_attributes(xml, measure_index, tuning)
      xml.attributes do
        xml.divisions DIVISIONS
        xml.key { xml.fifths 1 }  # G major (1 sharp)
        xml.time { xml.beats BEATS_PER_MEASURE; xml.send("beat-type", 4) }
        xml.clef { xml.sign "G"; xml.line 2 }

        # Staff details for tablature
        xml.send("staff-details", "print-object" => "yes") do
          xml.send("staff-lines", 5)
          xml.send("staff-tuning") do
            # Tuning is specified from low to high in MusicXML
            tuning.reverse.each do |pitch|
              xml.send("tuning-step", pitch_step(pitch))
              xml.send("tuning-octave", pitch_octave(pitch))
              xml.send("tuning-alter", 0)
            end
          end
        end
      end
    end

    def self.write_measure_notes(xml, measure_index, timeline, annotations, tuning)
      measure_start = measure_index * TICKS_PER_QUARTER * BEATS_PER_MEASURE
      measure_end = measure_start + TICKS_PER_QUARTER * BEATS_PER_MEASURE

      measure_notes = timeline.select do |entry|
        entry[:measure] == measure_index && entry[:tick] >= measure_start && entry[:tick] < measure_end
      end

      # Build technique pairs for this measure (hammer-on/pull-off)
      technique_pairs = build_technique_pairs(measure_notes)

      measure_notes.each do |entry|
        if entry[:rest]
          write_rest(xml, entry[:duration])
        else
          write_note(xml, entry, technique_pairs, annotations, tuning)
        end
      end
    end

    def self.write_rest(xml, duration)
      xml.note do
        xml.rest
        xml.duration duration
      end
    end

    def self.write_note(xml, entry, technique_pairs, annotations, tuning)
      string = entry[:string]  # 1-5, 1=highest
      fret = entry[:fret]
      duration = entry[:duration]
      component_index = entry[:index]

      # Compute pitch for notation staff (staff 1)
      # String 1 = tuning[0] (highest), String 5 = tuning[4] (lowest)
      string_pitch = tuning[string - 1]
      note_pitch = string_pitch + fret

      xml.note do
        # Notation staff pitch
        xml.pitch do
          xml.step pitch_step(note_pitch)
          xml.octave pitch_octave(note_pitch)
          xml.alter 0
        end

        xml.duration duration
        xml.voice 1
        xml.type note_type(duration)
        xml.staff 1  # Staff 1 = notation, Staff 2 = tab (we'll rely on alphaTab's duplication logic)

        # Tablature info
        xml.notations do
          xml.technical do
            # Hammer-on / pull-off
            pair_key = [ string, component_index ]
            if (pair = technique_pairs[pair_key])
              if pair[:stop_for]
                xml.send(pair[:kind], type: "start", number: pair[:number])
              else
                # Find the pair where this note is the stop.
                stop_pair = technique_pairs.values.find { |p| p[:stop_for] == component_index && p[:string] == string }
                xml.send(stop_pair[:kind], type: "stop", number: stop_pair[:number]) if stop_pair
              end
            end

            # TEF2 codes 2 and 4 display as circled fingers 1 and 3.
            if (ann_code = annotations[component_index]) && [ 2, 4 ].include?(ann_code)
              xml.fingering(enclosure: "circle") { xml.text({ 2 => 1, 4 => 3 }.fetch(ann_code)) }
            elsif ann_code == 6
              xml.send("other-technical") { xml.text "TEF fingering code 6" }
            end
          end
        end
      end
    end

    # Build technique pairs (hammer-on/pull-off) from consecutive notes on same string
    # @return [Hash] key=[string, from_index] => { kind, number, stop_for }
    def self.build_technique_pairs(notes)
      pairs = {}
      notes_by_string = notes.reject { |n| n[:rest] }.group_by { |n| n[:string] }

      notes_by_string.each do |string, string_notes|
        string_notes.sort_by! { |n| n[:tick] }

        string_notes.each_cons(2) do |from, to|
          next if from[:rest] || to[:rest]

          # TEF2 effect1: 1 = hammer-on, 2 = pull-off
          if from[:effect1] == 1
            pair_num = from[:index]
            pairs[[ string, from[:index] ]] = { kind: "hammer-on", number: pair_num, stop_for: to[:index], string: string }
            pairs[[ string, to[:index] ]] = { kind: "hammer-on", number: pair_num, string: string }
          elsif from[:effect1] == 2
            pair_num = from[:index]
            pairs[[ string, from[:index] ]] = { kind: "pull-off", number: pair_num, stop_for: to[:index], string: string }
            pairs[[ string, to[:index] ]] = { kind: "pull-off", number: pair_num, string: string }
          end
        end
      end

      pairs
    end

    def self.pitch_step(midi_pitch)
      %w[C C# D D# E F F# G G# A A# B][midi_pitch % 12]
    end

    def self.pitch_octave(midi_pitch)
      midi_pitch / 12
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
