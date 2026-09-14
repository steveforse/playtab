# frozen_string_literal: true

module Tef2
  # TEF2 parser ported from TuxGuitar's TEInputStream and TESongParser.
  # Component positions are kept in TEF ticks (256 ticks per quarter note).
  class FullParser
    HEADER_SIZE = 258
    COMPONENT_SIZE = 6
    MAX_MEASURES = 256
    MAX_COMPONENTS = 8192
    MAX_FILE_SIZE = 100_000
    MIN_FILE_SIZE = 258
    TEF2_TICKS_PER_QUARTER = 256
    TEF2_POSITION_UNITS_PER_QUARTER = 64

    class Invalid < StandardError; end

    TYPE_TIME_SIG_CHANGE = 27
    TYPE_CHORD = 28
    TYPE_TEXT = 29
    TYPE_ENDING = 30
    TYPE_ENDING_ALT = 94
    TYPE_TEMPO_CHANGE = 254

    def self.parse(bytes)
      bytes = bytes.bytes if bytes.is_a?(String)
      validate_header!(bytes)

      header = parse_header(bytes)
      components = parse_components(bytes, header)
      tail = parse_tail(bytes, header)
      track = tail[:tracks].first

      text_values = tail[:texts]
      text_markers = components[:texts]
      texts = if text_markers.any?
        text_markers.filter_map do |marker|
          value = text_values[marker[:text_id]].to_s.delete_prefix("\0").strip
          next if value.empty?

          marker.merge(text: value, anchored: true)
        end
      else
        text_values.filter_map do |text|
          value = text.to_s.delete_prefix("\0").strip
          next if value.empty?

          { measure: 0, position: 0, text: value, type: :text, anchored: false }
        end
      end
      chords = components[:chords].filter_map do |component|
        definition = tail[:chords][component[:chord_id]]
        next unless definition

        component.merge(
          name: definition[:name],
          strings: definition[:strings].first(header[:strings]),
          first_fret: definition[:first_fret]
        )
      end

      raise Invalid, "TEF2 does not contain a track" unless track
      raise Invalid, "TEF2 track count must be one" unless header[:tracks] == 1
      raise Invalid, "TEF2 track must contain five strings" unless track[:tuning]&.length == 5
      raise Invalid, "TEF2 percussion tracks are unsupported" if track[:percussion]

      {
        measures: header[:measures],
        time_signature: header[:time_signature],
        measure_signatures: measure_signatures(header, components[:time_sig_changes]),
        tempo: header[:tempo],
        strings: header[:strings],
        tracks: header[:tracks],
        component_count: header[:component_count],
        tuning: track[:tuning],
        track_data: tail[:tracks],
        notes: components[:notes],
        chords: chords,
        tempo_changes: components[:tempo_changes],
        time_sig_changes: components[:time_sig_changes],
        endings: components[:endings],
        repeats: tail[:repeats],
        texts: texts,
        lyrics_text: tail[:lyrics_text],
        percussions: tail[:percussions],
        rhythms: tail[:rhythms],
        annotations: components[:annotations]
      }
    end

    def self.validate_header!(bytes)
      raise Invalid, "File too small (#{bytes.length} bytes, minimum #{MIN_FILE_SIZE})" if bytes.length < MIN_FILE_SIZE
      raise Invalid, "File too large (#{bytes.length} bytes, maximum #{MAX_FILE_SIZE})" if bytes.length > MAX_FILE_SIZE

      measures = header_measures(bytes)
      raise Invalid, "Invalid measure count: #{measures} (expected 1–#{MAX_MEASURES})" unless (1..MAX_MEASURES).cover?(measures)
      numerator = bytes[202]
      denominator = bytes[204]
      raise Invalid, "Invalid time signature numerator: #{numerator}" unless (1..32).cover?(numerator)
      raise Invalid, "Invalid time signature denominator: #{denominator}" unless [ 1, 2, 4, 8, 16, 32 ].include?(denominator)
      raise Invalid, "String count must be 5, got #{bytes[240]}" unless bytes[240] == 5

      count = component_count(bytes)
      raise Invalid, "Invalid component count: #{count} (expected 1–#{MAX_COMPONENTS})" unless (1..MAX_COMPONENTS).cover?(count)

      expected_min_size = HEADER_SIZE + count * COMPONENT_SIZE
      raise Invalid, "Truncated file: #{bytes.length} bytes, need at least #{expected_min_size}" unless bytes.length >= expected_min_size
    end

    def self.parse_header(bytes)
      {
        measures: header_measures(bytes),
        time_signature: { numerator: bytes[202], denominator: bytes[204] },
        tempo: bytes[220] | (bytes[221] << 8),
        strings: bytes[240],
        tracks: bytes[241] + 1,
        repeats: bytes[222],
        texts: bytes[228],
        percussions: bytes[234],
        rhythms: bytes[235],
        chords: bytes[236],
        has_notes: bytes[238] > 0,
        component_count: component_count(bytes)
      }
    end

    def self.parse_components(bytes, header)
      count = header[:component_count]
      strings = header[:strings]
      time_sig = header[:time_signature]
      ticks_per_beat = TEF2_TICKS_PER_QUARTER * time_sig[:numerator] / time_sig[:denominator]
      component_measure_divisor = ticks_per_beat * strings

      notes = []
      chords = []
      tempo_changes = []
      time_sig_changes = []
      endings = []
      texts = []
      annotations = {}
      measure_base = 0
      previous_measure = 0
      position_offset = 0

      (0...count).each do |index|
        offset = HEADER_SIZE + index * COMPONENT_SIZE
        raise Invalid, "Truncated TEF2 component table" if offset + COMPONENT_SIZE > bytes.length

        b0, b1, b2, b3, b4, b5 = bytes[offset, COMPONENT_SIZE]
        candidate_position = b0 + ((measure_base + b1) * 256)
        candidate_measure = candidate_position / component_measure_divisor

        if candidate_measure < previous_measure
          measure_base += 256
          candidate_position = b0 + ((measure_base + b1) * 256)
          candidate_measure = candidate_position / component_measure_divisor
        end

        raw_position = candidate_position % ticks_per_beat
        string = (candidate_position / ticks_per_beat) % strings
        measure = candidate_position / ticks_per_beat / strings
        position = raw_position - (measure == previous_measure ? position_offset : 0)
        position *= TEF2_TICKS_PER_QUARTER / TEF2_POSITION_UNITS_PER_QUARTER
        previous_measure = measure

        fret_code = b2 & 0x1F
        if (1..25).cover?(fret_code)
          # A note component is laid out as fret/effect flag, duration and
          # dynamic, primary effect, secondary effect.  The high fret bit
          # means b5 is an annotation value; it does not replace b3's
          # duration code.
          annotation = (b2 & 0x20) != 0 ? b5 : nil
          duration_code = b3 & 0x1F
          effect1 = b4
          effect2 = annotation ? 0 : b5

          note_index = notes.length
          notes << {
            index: note_index,
            component_index: index,
            measure: measure,
            position: position,
            string: string,
            fret: fret_code - 1,
            technique: effect1,
            effect1: effect1,
            effect2: effect2,
            tef2_duration: duration_ticks(duration_code),
            duration_code: duration_code,
            tuplet: tuplet_duration?(duration_code),
            dynamic: b3 >> 5,
            annotation: annotation
          }
          annotations[note_index] = annotation if annotation
        elsif (b2 & 0x1F) == TYPE_TIME_SIG_CHANGE
          denominator = (2**(b2 >> 5)) / 2
          numerator = ((ticks_per_beat / 4 - (b3 & 0xFF)) * denominator) / 64
          time_sig_changes << {
            measure: measure,
            position: position,
            numerator: numerator,
            denominator: denominator,
            type: :time_sig_change
          }
          position_offset = (b3 & 0xFF) * 4
        elsif (b2 & 0x1F) == TYPE_CHORD
          chords << { measure: measure, position: position, string: string, chord_id: b3, type: :chord }
        elsif (b2 & 0x1F) == TYPE_TEXT
          texts << { measure: measure, position: position, string: string, text_id: b3, type: :text }
        elsif b2 == TYPE_TEMPO_CHANGE
          tempo_changes << { measure: measure, position: position, tempo: (b4 << 8) | b3, type: :tempo_change }
        elsif b2 == TYPE_ENDING_ALT || (b2 & 0x1F) == TYPE_ENDING
          flags = b2 == TYPE_ENDING_ALT ? b4 : 0
          endings << {
            measure: measure,
            position: position,
            ending_type: b2,
            ending_number: flags & 0x07,
            is_open: (flags & 0x40) != 0,
            is_close: (flags & 0x80) != 0,
            type: :ending
          }
        end
      end

      notes = assign_chord_durations(notes)
      infer_annotation_durations(notes, header[:measures])
      { notes: notes, chords: chords, texts: texts, tempo_changes: tempo_changes, time_sig_changes: time_sig_changes,
        endings: endings, annotations: annotations }
    end

    def self.measure_signatures(header, changes)
      signatures = Array.new(header[:measures], header[:time_signature].dup)
      changes.each do |change|
        next unless signatures[change[:measure]] && change[:numerator].positive? && change[:denominator].positive?

        signatures[change[:measure]] = {
          numerator: change[:numerator],
          denominator: change[:denominator]
        }
      end
      signatures
    end

    def self.duration_ticks(code)
      special_dotted = [ 20, 23, 26, 29 ].include?(code)
      special_triplet = [ 21, 24, 27, 30 ].include?(code)
      value = if special_dotted
                 16
      elsif special_triplet
                 64
      else
                 normalized = code > 18 ? code - 18 : code
                 base = 1
                 base *= 2 while normalized >= 3 && (normalized -= 3)
                 base *= 2 if normalized == 1
                 base
      end

      ticks = (TEF2_TICKS_PER_QUARTER * 4.0 / value)
      if code == 31
        ticks *= 1.5
      elsif code > 18 && !special_dotted && !special_triplet
        ticks *= 1.75
      elsif code % 3 == 1
        ticks *= 1.5
      elsif code % 3 == 2
        ticks *= 2.0 / 3.0
      end
      [ ticks.round, 1 ].max
    end

    def self.tuplet_duration?(code)
      code % 3 == 2 && ![ 20, 23, 26, 29 ].include?(code)
    end

    def self.assign_chord_durations(notes)
      notes.group_by { |note| [ note[:measure], note[:position] ] }.each_value do |group|
        next if group.length <= 1

        duration = group.map { |note| note[:tef2_duration] }.max
        primary = group.find { |note| note[:tef2_duration] == duration } || group.first
        group.each do |note|
          note[:tef2_duration] = duration
          note[:is_chord] = note != primary
        end
      end
      notes
    end

    def self.infer_annotation_durations(notes, measure_count)
      notes.group_by { |note| note[:measure] }.each do |measure, measure_notes|
        onsets = measure_notes.map { |note| note[:position] }.uniq.sort
        measure_notes.each do |note|
          next unless note[:annotation]

          next_onset = onsets.find { |onset| onset > note[:position] }
          note[:tef2_duration] = (next_onset || TEF2_TICKS_PER_QUARTER * 4) - note[:position]
        end
      end
    end

    def self.parse_tail(bytes, header)
      offset = HEADER_SIZE + header[:component_count] * COMPONENT_SIZE
      repeats = []
      header[:repeats].times do
        raise Invalid, "Truncated TEF2 repeat table" if offset + 2 > bytes.length
        repeats << { start: bytes[offset], length: bytes[offset + 1] }
        offset += 2
      end

      texts = []
      header[:texts].times do
        length = bytes[offset]
        raise Invalid, "Truncated TEF2 text table" unless length && offset + length + 2 <= bytes.length
        offset += 1
        texts << decode_text(bytes[offset, length])
        offset += length + 1
      end

      if header[:percussions].positive?
        offset += header[:percussions] * (96 + 8 + 1 + 1 + 2) + header[:measures]
      end

      chords = []
      header[:chords].times do
        raise Invalid, "Truncated TEF2 chord table" unless offset + 32 <= bytes.length
        record = bytes[offset, 32]
        strings = record[0, 14].map do |value|
          value == 0xFF ? -1 : value
        end
        name = decode_text(record[14, 16]).split("\0", 2).first.to_s.strip
        chords << { name: name, strings: strings, first_fret: 1 }
        offset += 32
      end

      if header[:rhythms].positive?
        offset += header[:rhythms] * (96 + 8 + 1 + 2 + 1) + header[:measures]
      end

      if header[:has_notes]
        length = read_short(bytes, offset)
        raise Invalid, "Truncated TEF2 free-text block" unless length && offset + 2 + length <= bytes.length
        offset += 2 + length
        lyrics_text = decode_text(bytes[offset - length, length])
      end

      tracks = []
      header[:tracks].times do
        string_count = bytes[offset]
        raise Invalid, "Truncated TEF2 track record" unless string_count
        offset += 1 + 5
        percussion_marker = bytes[offset]
        offset += 2
        instrument = bytes[offset]
        offset += 4
        capo = bytes[offset]
        offset += 2
        clef_type = bytes[offset]
        clef_number = bytes[offset + 1]
        offset += 3
        pan = bytes[offset]
        volume = bytes[offset + 1]
        flags = bytes[offset + 2]
        offset += 3
        tuning_values = bytes[offset, string_count]
        raise Invalid, "Truncated TEF2 tuning" unless tuning_values&.length == string_count
        offset += 12
        name = decode_text(bytes[offset, 16]).delete("\0")
        offset += 18
        tracks << {
          percussion: percussion_marker == 98,
          instrument: instrument,
          capo: capo,
          clef_type: clef_type,
          clef_number: clef_number,
          pan: pan,
          volume: volume,
          flags: flags,
          tuning: tuning_values.map { |value| 96 - value },
          name: name
        }
      end

      { repeats: repeats, texts: texts, lyrics_text: lyrics_text, percussions: [], chords: chords, rhythms: [], tracks: tracks }
    end

    def self.read_short(bytes, offset)
      (bytes[offset] & 0xFF) | ((bytes[offset + 1] & 0xFF) << 8)
    end

    def self.decode_text(values)
      raw = values.pack("C*")
      utf8 = raw.dup.force_encoding(Encoding::UTF_8)
      return utf8 if utf8.valid_encoding?

      raw.force_encoding(Encoding::Windows_1252).encode(Encoding::UTF_8)
    rescue EncodingError
      raw.force_encoding(Encoding::ISO_8859_1).encode(Encoding::UTF_8)
    end

    def self.header_measures(bytes)
      bytes[200] | (bytes[201] << 8)
    end

    def self.component_count(bytes)
      bytes[256] | (bytes[257] << 8)
    end
  end
end
