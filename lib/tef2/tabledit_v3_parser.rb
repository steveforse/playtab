# frozen_string_literal: true

module Tef2
  # Parser for the TablEdit 3.00 TEF layout used by newer .tef files.
  #
  # TablEdit stores note positions in 64ths of a whole note.  The rest of
  # the native conversion pipeline uses 256 TEF ticks per quarter note, so
  # positions and durations are normalized while the file is read.
  class TableditV3Parser
    MAGIC = "debt".b.freeze
    MAX_MEASURES = 256
    MAX_RECORDS = 100_000
    TEF2_TICKS_PER_QUARTER = 256
    TABLEDIT_UNITS_PER_WHOLE = 64

    class Invalid < StandardError; end

    def self.tabledit_v3?(bytes)
      bytes = bytes.bytes if bytes.is_a?(String)
      bytes.length >= 0xCE && bytes[0x38, 4]&.pack("C*") == MAGIC && (read_u16(bytes, 0xCC) >> 8) == 10
    end

    def self.parse(bytes)
      bytes = bytes.bytes if bytes.is_a?(String)
      validate_file!(bytes)

      measures = parse_measures(bytes)
      instruments = parse_instruments(bytes)
      raise Invalid, "TablEdit file must contain one instrument" unless instruments.length == 1

      instrument = instruments.first
      raise Invalid, "TablEdit track must contain five strings" unless instrument[:strings] == 5

      notes, marker_count, chord_markers, text_markers, endings, tempo_changes = parse_contents(bytes, measures, instrument[:strings])
      raise Invalid, "TablEdit file contains no notes" if notes.empty?

      text_values = parse_texts(bytes)
      texts = text_markers.filter_map do |marker|
        text = text_values[marker[:text_index]]
        next if text.to_s.empty?

        marker.merge(text: text, type: :text)
      end
      chord_definitions = parse_chords(bytes)
      chords = chord_markers.filter_map do |marker|
        definition = chord_definitions[marker[:chord_id]]
        next unless definition

        marker.merge(
          name: definition[:name],
          strings: definition[:strings].first(instrument[:strings]),
          first_fret: definition[:first_fret],
          type: :chord
        )
      end

      {
        measures: measures.length,
        measure_signatures: measures.map { |measure| measure.slice(:numerator, :denominator) },
        time_signature: measures.first.slice(:numerator, :denominator),
        tempo: read_u16(bytes, 6),
        strings: instrument[:strings],
        tracks: instruments.length,
        component_count: marker_count,
        tuning: instrument[:tuning],
        track_data: instruments,
        notes: assign_chord_durations(notes),
        chords: chords,
        tempo_changes: tempo_changes,
        time_sig_changes: [],
        endings: endings,
        repeats: [],
        texts: texts,
        percussions: [],
        rhythms: [],
        annotations: {},
        title: indirect_text(bytes, 0x40),
        subtitle: indirect_text(bytes, 0x44),
        comment: indirect_text(bytes, 0x48)
      }
    end

    def self.validate_file!(bytes)
      raise Invalid, "File too small for TablEdit 3.00 header" if bytes.length < 0xCE
      raise Invalid, "Invalid TablEdit file signature" unless bytes[0x38, 4]&.pack("C*") == MAGIC

      format = read_u16(bytes, 0xCC)
      raise Invalid, "Unsupported TablEdit format #{format >> 8}.00" unless (format >> 8) == 10
      raise Invalid, "Protected TablEdit files are unsupported" unless read_u32(bytes, 0x10).zero?
    end

    def self.parse_measures(bytes)
      pointer = read_u32(bytes, 0x5C)
      reader = Reader.new(bytes, pointer)
      reader.require!(8)
      structure_size = reader.u16
      count = reader.u16
      reader.skip(4)
      raise Invalid, "Invalid TablEdit measure count: #{count}" unless (1..MAX_MEASURES).cover?(count)
      raise Invalid, "Invalid TablEdit measure structure size: #{structure_size}" if structure_size < 8

      measures = count.times.map do
        reader.require!(8)
        flag = reader.u8
        reader.skip(1)
        key = reader.i8
        size = reader.u8
        denominator = reader.u8
        numerator = reader.u8
        reader.skip(2)
        raise Invalid, "Invalid TablEdit time signature" unless numerator.positive? && denominator.positive?

        units_numerator = numerator * TABLEDIT_UNITS_PER_WHOLE
        raise Invalid, "Unsupported non-integer TablEdit measure length" unless (units_numerator % denominator).zero?
        units = units_numerator / denominator

        {
          flag: flag,
          key: key,
          size: size,
          numerator: numerator,
          denominator: denominator,
          length_units: units
        }
      end

      measures
    rescue IndexError
      raise Invalid, "Truncated TablEdit measure section"
    end

    def self.parse_instruments(bytes)
      pointer = read_u32(bytes, 0x60)
      reader = Reader.new(bytes, pointer)
      reader.require!(4)
      structure_size = reader.u16
      count = reader.u16
      raise Invalid, "Invalid TablEdit instrument count" unless count.positive?
      raise Invalid, "Invalid TablEdit instrument structure size" if structure_size < 68

      count.times.map do
        reader.require!(68)
        strings = reader.u16
        first_string = reader.u16
        reader.skip(2)
        reader.skip(2)
        midi_voice = reader.u8
        midi_bank = reader.u8
        banjo5 = reader.u8
        reader.skip(1)
        capo = reader.u16
        middle_c = reader.u8
        clef = reader.u8
        output = reader.u16
        options = reader.u16
        raw_tuning = reader.bytes(12)
        name = decode_text(reader.bytes(36).take_while { |byte| byte != 0 })

        {
          strings: strings,
          first_string: first_string,
          midi_voice: midi_voice,
          midi_bank: midi_bank,
          banjo5: banjo5,
          capo: capo,
          middle_c: middle_c,
          clef: clef,
          output: output,
          options: options,
          tuning: raw_tuning.first(strings).map { |value| 96 - value },
          name: name
        }
      end
    rescue IndexError
      raise Invalid, "Truncated TablEdit instrument section"
    end

    def self.parse_contents(bytes, measures, string_count)
      pointer = read_u32(bytes, 0x3C)
      reader = Reader.new(bytes, pointer)
      reader.require!(4)
      offset = reader.u32
      notes = []
      marker_count = 0
      chord_markers = []
      text_markers = []
      endings = []
      tempo_changes = []
      measure_starts = [ 0 ]
      measures.each { |measure| measure_starts << measure_starts.last + measure[:length_units] }

      while offset != 0xFFFFFFFF
        marker_count += 1
        raise Invalid, "Too many TablEdit content records" if marker_count > MAX_RECORDS

        reader.require!(12)
        byte1 = reader.u8
        byte2 = reader.u8
        byte3 = reader.u8
        byte4 = reader.u8
        byte5 = reader.u8
        byte6 = reader.u8
        byte7 = reader.u8
        byte8 = reader.u8

        slot = offset >> 3
        absolute_units = slot / string_count
        string = (slot % string_count)
        marker = byte1 & 0x3F

        if marker < 0x33
          measure, local_units = locate_measure(measure_starts, absolute_units)
          duration_code = byte2 & 0x1F
          effect1 = byte3 & 0x0F
          effect2 = byte5 & 0x0F
          effect3 = (byte5 >> 4) & 0x0F
          fingering_combo = byte7 & 0x1F
          notes << {
            index: notes.length,
            component_index: marker_count - 1,
            absolute_position: absolute_units * TEF2_TICKS_PER_QUARTER / 16,
            measure: measure,
            position: local_units * TEF2_TICKS_PER_QUARTER / 16,
            string: string,
            fret: marker - 1,
            technique: effect1,
            effect1: effect1,
            effect2: effect2,
            effect3: effect3,
            modern_tabledit: true,
            pitch_shift: byte4 & 0x07,
            grace_note_effect: (byte4 >> 5) & 0x07,
            grace_note_fret: byte4 & 0x1F,
            tef2_duration: duration_ticks(duration_code),
            duration_code: duration_code,
            tuplet: tuplet_duration?(duration_code),
            dynamic: (byte2 >> 5) & 0x07,
            fingering_combo: fingering_combo,
            fingerings: modern_fingerings(fingering_combo),
            stroke: byte7 >> 5,
            note_attributes: byte8,
            attributes: (byte3 >> 4) & 0x03,
            annotation: nil,
            tie: (byte8 & 0x02) != 0 || (byte2 & 0x80) != 0,
            grace: (byte1 & 0x40) != 0,
            voice: (((byte3 >> 4) & 0x03) == 3 ? 2 : 1)
          }
        elsif marker == 0x39
          measure, local_units = locate_measure(measure_starts, absolute_units)
          text_markers << {
            measure: measure,
            position: local_units * TEF2_TICKS_PER_QUARTER / 16,
            string: string,
            text_index: byte2 | (byte3 << 8)
          }
        elsif marker == 0x35
          measure, local_units = locate_measure(measure_starts, absolute_units)
          chord_markers << {
            measure: measure,
            position: local_units * TEF2_TICKS_PER_QUARTER / 16,
            string: string,
            chord_id: byte2 | (byte3 << 8)
          }
        elsif marker == 0x33
          # Gaps are emitted as MusicXML rests by the builder.
          nil
        elsif byte1 == 0xB7
          measure, local_units = locate_measure(measure_starts, absolute_units)
          ending_flags = byte3
          endings << {
            measure: measure,
            position: local_units * TEF2_TICKS_PER_QUARTER / 16,
            ending_number: ending_flags & 0x07,
            ending_flags: (ending_flags >> 3) & 0x07,
            is_open: (ending_flags & 0x40) != 0,
            is_close: (ending_flags & 0x80) != 0,
            type: :ending
          }
        elsif byte1 == 0xFE
          measure, local_units = locate_measure(measure_starts, absolute_units)
          tempo_changes << {
            measure: measure,
            position: local_units * TEF2_TICKS_PER_QUARTER / 16,
            tempo: byte2 | (byte3 << 8),
            type: :tempo_change
          }
        end

        offset = reader.u32
      end

      [ notes, marker_count, chord_markers, text_markers, endings, tempo_changes ]
    rescue IndexError
      raise Invalid, "Truncated TablEdit content section"
    end

    def self.locate_measure(starts, absolute_units)
      index = starts.each_cons(2).with_index.find { |(_start, finish), _index| absolute_units < finish }&.last
      raise Invalid, "TablEdit note lies outside its measure map" unless index

      [ index, absolute_units - starts[index] ]
    end

    # TablEdit's TEF3 files use the low values as the displayed fretting-hand
    # fingers: 2=1, 3=2, 4=3, and 5=4. Value 6 is the thumb marker. This is
    # the mapping confirmed by the original TefView rendering; TuxGuitar's
    # older enum shifts the first four values by one.
    def self.modern_fingerings(combo)
      case combo
      when 2..5 then [ combo - 1 ]
      when 6 then [ "T" ]
      else []
      end
    end

    def self.assign_chord_durations(notes)
      notes.group_by { |note| [ note[:measure], note[:position] ] }.each_value do |group|
        next if group.length <= 1

        duration = group.map { |note| note[:tef2_duration] }.max
        primary = group.find { |note| note[:tef2_duration] == duration } || group.first
        group.each do |note|
          is_primary = note.equal?(primary)
          note[:tef2_duration] = duration
          note[:is_chord] = !is_primary
        end
      end
      notes.each { |note| note[:is_chord] = false unless note.key?(:is_chord) }
    end

    def self.duration_ticks(code)
      length_units = {
        0 => 64, 1 => 48, 2 => 32, 3 => 32, 4 => 24, 5 => 16,
        6 => 16, 7 => 12, 8 => 8, 9 => 8, 10 => 6, 11 => 4,
        12 => 4, 13 => 3, 14 => 2, 15 => 2, 17 => 1, 18 => 1,
        19 => 56, 22 => 28, 25 => 14, 28 => 7
      }[code]
      raise Invalid, "Unsupported TablEdit duration code #{code}" unless length_units

      length_units * TEF2_TICKS_PER_QUARTER / 16
    end

    def self.tuplet_duration?(code)
      [ 2, 5, 8, 11, 14, 17 ].include?(code)
    end

    def self.parse_texts(bytes)
      pointer = read_u32(bytes, 0x54)
      return [] if pointer.zero?

      reader = Reader.new(bytes, pointer)
      count = reader.u16
      count.times.map { reader.text }
    rescue IndexError
      raise Invalid, "Truncated TablEdit text section"
    end

    def self.parse_chords(bytes)
      pointer = read_u32(bytes, 0x58)
      return [] if pointer.zero?

      reader = Reader.new(bytes, pointer)
      structure_size = reader.u16
      count = reader.u16
      raise Invalid, "Invalid TablEdit chord structure size" if structure_size < 32

      count.times.map do
        record = reader.bytes(structure_size)
        frets = record.first(7).map do |value|
          symbol = value >> 5
          low_fret = value & 0x1F
          symbol == 7 || low_fret == 0x1F ? -1 : low_fret
        end
        name = decode_text(record[14, 17].take_while { |value| value != 0 }).strip
        first_fret = record[31].to_i
        { name: name, strings: frets, first_fret: first_fret.positive? ? first_fret : 1 }
      end
    rescue IndexError
      raise Invalid, "Truncated TablEdit chord section"
    end

    def self.indirect_text(bytes, field_offset)
      pointer = read_u32(bytes, field_offset)
      return "" if pointer.zero?

      Reader.new(bytes, pointer).text
    rescue IndexError
      raise Invalid, "Truncated TablEdit text field"
    end

    def self.read_u16(bytes, offset)
      bytes.fetch(offset) | (bytes.fetch(offset + 1) << 8)
    rescue IndexError
      raise Invalid, "Truncated TablEdit header"
    end

    def self.decode_text(values)
      raw = values.pack("C*")
      utf8 = raw.dup.force_encoding(Encoding::UTF_8)
      return utf8 if utf8.valid_encoding?

      raw.force_encoding(Encoding::Windows_1252).encode(Encoding::UTF_8)
    rescue EncodingError
      raw.force_encoding(Encoding::ISO_8859_1).encode(Encoding::UTF_8)
    end

    def self.read_u32(bytes, offset)
      bytes.fetch(offset) |
        (bytes.fetch(offset + 1) << 8) |
        (bytes.fetch(offset + 2) << 16) |
        (bytes.fetch(offset + 3) << 24)
    rescue IndexError
      raise Invalid, "Truncated TablEdit pointer table"
    end

    class Reader
      def initialize(bytes, position)
        @bytes = bytes
        @position = position
      end

      def require!(length)
        raise IndexError if @position.negative? || @position + length > @bytes.length
      end

      def skip(length)
        require!(length)
        @position += length
      end

      def u8
        require!(1)
        value = @bytes[@position]
        @position += 1
        value
      end

      def i8
        value = u8
        value >= 128 ? value - 256 : value
      end

      def u16
        u8 | (u8 << 8)
      end

      def u32
        u8 | (u8 << 8) | (u8 << 16) | (u8 << 24)
      end

      def bytes(length)
        require!(length)
        value = @bytes[@position, length]
        @position += length
        value
      end

      def text
        size = u16
        raise IndexError if size.zero?

        value = TableditV3Parser.decode_text(bytes(size - 1))
        u8
        value
      end
    end
  end
end
