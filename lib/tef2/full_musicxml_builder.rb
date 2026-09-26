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

    # Verified TEF2 fingering annotation codes -> displayed finger number
    # (2-5 = fingers 1-4; 18 = middle finger, verified against TefView "M").
    # Code 6 is the thumb and renders as the "TEF fingering T" label.
    FINGERING_ANNOTATIONS = { 2 => "1", 3 => "2", 4 => "3", 5 => "4", 18 => "2" }.freeze

    # Annotation codes verified in TefView to have no useful visible meaning,
    # omitted from the rendered score: 1 = enlarged fret number (display
    # emphasis), 96 = stray unfilled down-triangle (likely accidental),
    # 198 = no visible rendering at all.
    SUPPRESSED_ANNOTATIONS = [ 1, 96, 198 ].freeze

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
      capo = (parsed[:track_data] || []).map { |track| track[:capo].to_i }.max.to_i
      lyrics_text = parsed[:lyrics_text].to_s
      instrument = (parsed[:track_data] || []).first || {}
      guides = parsed[:reading_guides]
      # TablEdit 3 keeps a key per measure; TEF2 imports keep G major.
      keys = parsed[:measure_keys] || Array.new(measures, 1)

      builder = Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
        xml.send("score-partwise", version: "3.1") do
          write_identification(xml, lyrics_text, instrument)

          xml.send("part-list") do
            xml.send("score-part", id: "P1") do
              xml.send("part-name", "Banjo")
              xml.send("score-instrument", id: "P1-I1") do
                xml.send("instrument-name", "Banjo")
              end
              xml.send("midi-instrument", id: "P1-I1") do
                xml.send("midi-channel", 1)
                # MusicXML program and bank numbers are one-based; TablEdit's
                # are zero-based (105 is the General MIDI banjo).
                xml.send("midi-program", (instrument[:midi_voice] || 105).to_i.clamp(0, 127) + 1)
                xml.send("midi-bank", instrument[:midi_bank].to_i + 1)
              end
            end
          end

          xml.part(id: "P1") do
            measures.times do |m|
              xml.measure(number: m + 1) do
                measure_time_sig = measure_signatures&.fetch(m, time_sig) || time_sig
                write_measure_attributes(xml, m, measure_time_sig, tempo, strings, tuning, key: keys[0].to_i) if m == 0
                write_capo_direction(xml, capo) if m == 0 && capo.positive?
                if m.positive?
                  key_change = keys[m] != keys[m - 1] ? keys[m].to_i : nil
                  time_change = measure_signatures && measure_time_sig != measure_signatures[m - 1] ? measure_time_sig : nil
                  write_measure_changes(xml, key_change, time_change) if key_change || time_change
                end
                write_tempo_direction(xml, tempo) if m == 0 && tempo > 0
                guides ? write_reading_guides(xml, guides, m, location: "left") : write_measure_barlines(xml, m, endings, location: "left")
                write_measure_notes(xml, m, notes, annotations, texts, chords, tempo_changes, strings, tuning, measure_time_sig, capo: capo)
                guides ? write_reading_guides(xml, guides, m, location: "right") : write_measure_barlines(xml, m, endings, location: "right")
              end
            end
          end
        end
      end
      builder.to_xml(save_with: Nokogiri::XML::Node::SaveOptions::FORMAT)
    end

    private

    def self.write_measure_attributes(xml, measure_index, time_sig, tempo, strings, tuning, key: 1)
      xml.attributes do
        xml.divisions DIVISIONS
        xml.key { xml.fifths key }
        write_time_signature(xml, time_sig)
        xml.staves 2

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

    def self.write_measure_changes(xml, key, time_sig)
      xml.attributes do
        xml.key { xml.fifths key } if key
        write_time_signature(xml, time_sig) if time_sig
      end
    end

    # Repeat signs, endings and jumps decoded from a TablEdit reading list
    # (ReadingList.decode). Endings use the shape the editor authors: each
    # numbered ending starts on its first measure's left barline and stops
    # on its last measure's right barline.
    def self.write_reading_guides(xml, bars, measure_index, location:)
      bar = bars[measure_index]
      previous = measure_index.positive? ? bars[measure_index - 1] : nil
      following = bars[measure_index + 1]
      if location == "left"
        ending_start = bar[:endings].any? && previous&.dig(:endings) != bar[:endings]
        if bar[:forward] || ending_start
          xml.barline(location: "left") do
            xml.ending(number: bar[:endings].join(","), type: "start") if ending_start
            xml.repeat(direction: "forward") if bar[:forward]
          end
        end
        write_jump_direction(xml, "segno") { xml.segno } if bar[:segno]
        write_jump_direction(xml, "coda") { xml.coda } if bar[:coda]
        return
      end

      # Jumps are measure-level sounds; alphaTab draws their D.C., D.S.,
      # To Coda and Fine text itself (Playtab reads a D.C./D.S. as al Coda
      # or al Fine when the score has a To Coda or Fine).
      xml.sound(tocoda: "coda") if bar[:to_coda]
      xml.sound(fine: "yes") if bar[:fine]
      xml.sound(dacapo: "yes") if bar[:dacapo]
      xml.sound(dalsegno: "segno") if bar[:dalsegno]
      ending_stop = bar[:endings].any? && following&.dig(:endings) != bar[:endings]
      return unless bar[:backward].positive? || ending_stop

      xml.barline(location: "right") do
        xml.send("bar-style", "light-heavy") if bar[:backward].positive?
        xml.ending(number: bar[:endings].join(","), type: "stop") if ending_stop
        xml.repeat(direction: "backward", times: bar[:backward]) if bar[:backward].positive?
      end
    end

    # A segno or coda sign; its <sound> attribute names the jump target.
    def self.write_jump_direction(xml, attribute)
      xml.direction(placement: "above") do
        xml.send("direction-type") { yield }
        xml.sound(attribute => attribute)
      end
    end

    def self.write_measure_barlines(xml, measure_index, endings, location:)
      measure_endings = endings.select { |ending| ending[:measure] == measure_index }
      return if measure_endings.empty?

      # One-measure volta spans synthesized from the TEF2 repeat table
      # (RepeatMap) and explicit single-measure endings: start at the left
      # barline, stop at the right barline.
      span_endings = measure_endings.select do |ending|
        ending[:span] && !ending[:is_close] && ending[:ending_number].to_i.positive?
      end

      if location == "left"
        forward = measure_endings.any? { |ending| ending[:is_open] }
        return if forward == false && span_endings.empty?

        xml.barline(location: "left") do
          xml.repeat(direction: "forward") if forward
          span_endings.each { |ending| xml.ending(number: ending[:ending_number].to_s, type: "start") }
        end
        return
      end

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

      measure_endings.select { |ending| !ending[:is_close] && !ending[:span] && ending[:ending_number].to_i.positive? }.each do |ending|
        xml.barline(location: "right") do
          xml.ending(number: ending[:ending_number], type: "start")
        end
      end

      span_endings.each do |ending|
        xml.barline(location: "right") do
          xml.ending(number: ending[:ending_number].to_s, type: "stop")
          xml.repeat(direction: "backward") if ending[:repeat]
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

    def self.write_measure_notes(xml, measure_index, notes, annotations, texts, chords, tempo_changes, strings, tuning, time_sig, capo: 0)
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

        write_note_notation(xml, note, technique_pairs, slide_pairs, tie_pairs, tuning, capo: capo)
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

        write_note_tab(xml, note, technique_pairs, slide_pairs, tie_pairs, annotations, strings, tuning, capo: capo)
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

    def self.write_capo_direction(xml, capo)
      xml.direction(placement: "above") do
        xml.send("direction-type") { xml.words("Capo #{capo}") }
        xml.staff 1
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

    # Tabledit-family TEFs store 5th-string frets relative to the open
    # 5th string while strings 1-4 are already capo-relative; printed
    # tabs show the 5th string capo-relative as well. Verified against
    # the printed Brainjo corpus on every capo file: subtracting the
    # capo from 5th-string frets makes all six mismatched files exact
    # and leaves the other eleven capo files unchanged.
    def self.display_fret(string_index, fret, capo)
      return fret unless capo.positive? && string_index == 4
      fret >= capo ? fret - capo : fret
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

    def self.write_note_notation(xml, note, technique_pairs, slide_pairs, tie_pairs, tuning, capo: 0)
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

      write_grace_note(xml, note, tuning, staff: 1, capo: capo) if note[:grace]

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

    def self.write_note_tab(xml, note, technique_pairs, slide_pairs, tie_pairs, annotations, strings, tuning, capo: 0)
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

      write_grace_note(xml, note, tuning, staff: 2, capo: capo) if note[:grace]

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

        write_note_notations(xml, note, pair, slide, tie, technique_number, tab: true, annotations: annotations, capo: capo)
      end
    end

    def self.write_grace_note(xml, note, tuning, staff:, capo: 0)
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
            xml.fret display_fret(string, fret, capo)
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

    def self.write_note_notations(xml, note, pair, slide, tie, technique_number, tab:, annotations: {}, capo: 0)
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
            xml.fret display_fret(note[:string], note[:fret], capo)
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
          write_effect_technical(xml, note, tab: tab)
          write_modern_fingerings(xml, note) if tab

          # TEF2 stores these as annotation payloads rather than as fret
          # extensions.  Verified codes become visible fingerings; suppressed
          # codes have no useful visible meaning; other codes remain explicit
          # technical metadata.
          if tab && (ann = annotations[note[:index]]) && !SUPPRESSED_ANNOTATIONS.include?(ann)
            if ann == 6
              xml.send("other-technical") { xml.text "TEF fingering T" }
            elsif (finger = FINGERING_ANNOTATIONS[ann])
              xml.fingering(enclosure: "circle") { xml.text finger }
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

    def self.write_effect_technical(xml, note, tab: false)
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
      metadata.concat(tef3_note_metadata(note)) if tab && note[:modern_tabledit]
      metadata.uniq.each { |value| xml.send("other-technical") { xml.text value } }
    end

    # TablEdit 3 note fields that Playtab does not render yet. They ride on
    # the tab note as metadata so TEF3 export writes the same bytes back:
    # the raw secondary effects (their rendered forms above are ambiguous or
    # lossy), a dynamic other than TablEdit's default level 2, and a pick
    # stroke other than none or the thumb marker.
    def self.tef3_note_metadata(note)
      metadata = []
      metadata << "TEF effect2 #{note[:effect2]}" if note[:effect2].to_i.positive?
      metadata << "TEF effect3 #{note[:effect3]}" if note[:effect3].to_i.positive?
      metadata << "TEF dynamic #{note[:dynamic]}" if note[:dynamic] && note[:dynamic].to_i != 2
      metadata << "TEF stroke #{note[:stroke]}" if note[:stroke].to_i > 1
      metadata
    end

    # TEF2 stores its optional "LYRICS & CHORDS" page as free text rather
    # than as note-aligned lyric events. Keep it in standard MusicXML metadata
    # so the frontend can render it as a separate section below the score.
    # TablEdit clef, middle-C and 5th-string capo bytes that Playtab does not
    # render are kept alongside it so TEF3 export can write them back.
    def self.write_identification(xml, lyrics_text, instrument)
      fields = {}
      fields["playtab-lyrics"] = lyrics_text.delete("\0") unless lyrics_text.empty?
      fields["playtab-tef-clef"] = instrument[:clef].to_s if instrument[:clef].to_i.positive?
      fields["playtab-tef-middle-c"] = instrument[:middle_c].to_s if instrument[:middle_c].to_i.positive?
      # The 5th-string capo byte normally equals the capo; a few files set
      # its 0x10 bit as well (meaning unknown), so keep any other value.
      fields["playtab-tef-banjo5"] = instrument[:banjo5].to_s if instrument[:banjo5] && instrument[:banjo5].to_i != instrument[:capo].to_i
      return if fields.empty?

      xml.identification do
        xml.miscellaneous do
          fields.each { |name, value| xml.send("miscellaneous-field", name: name) { xml.text value } }
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

          # TEF2 and modern TablEdit use the legato effect values for a
          # shared hammer/pull marker. The effect value is not a reliable
          # direction field across files, so use the written fret movement.
          # Same-fret markers are ambiguous and are not emitted as H/PO.
          kind = if dest[:fret].to_i > note[:fret].to_i
            "hammer-on"
          elsif dest[:fret].to_i < note[:fret].to_i
            "pull-off"
          end
          next unless kind
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
