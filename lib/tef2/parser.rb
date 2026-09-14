# frozen_string_literal: true

module Tef2
  # TEF2 file format parser for the full specification
  # Based on TuxGuitar's TEInputStream.java (tuxguitar-tef.jar)
  class Parser
    HEADER_SIZE = 258
    COMPONENT_SIZE = 6
    MAX_MEASURES = 256
    MAX_COMPONENTS = 8192
    MAX_FILE_SIZE = 100_000
    MIN_FILE_SIZE = 258

    class Invalid < StandardError; end

    # Component types (from byte 2 >> 5)
    TYPE_NOTE = 1..25
    TYPE_TIME_SIG_CHANGE = 27
    TYPE_CHORD = 28
    TYPE_TEMPO_CHANGE = 254
    TYPE_ENDING = 30
    TYPE_ENDING_ALT = 94

    # Parse TEF2 bytes into structured data
    # @param bytes [String, Array<Integer>] raw TEF2 file bytes
    # @return [Hash] { measures:, time_signature:, tempo:, strings:, tracks:, components:, annotations: }
    def self.parse(bytes)
      bytes = bytes.bytes if bytes.is_a?(String)
      validate_header!(bytes)

      header = parse_header(bytes)
      components_data = parse_components(bytes, header)
      notes = parse_notes(components_data)

      {
        measures: header[:measures],
        time_signature: header[:time_signature],
        tempo: header[:tempo],
        strings: header[:strings],
        tracks: header[:tracks],
        components: components_data[:components],
        annotations: components_data[:annotations],
        notes: notes,
        chords: components_data[:chords],
        tempo_changes: components_data[:tempo_changes],
        time_sig_changes: components_data[:time_sig_changes],
        endings: components_data[:endings]
      }
    end

    # Validate TEF2 header structure
    def self.validate_header!(bytes)
      raise Invalid, "File too small (#{bytes.length} bytes, minimum #{MIN_FILE_SIZE})" if bytes.length < MIN_FILE_SIZE
      raise Invalid, "File too large (#{bytes.length} bytes, maximum #{MAX_FILE_SIZE})" if bytes.length > MAX_FILE_SIZE

      measures = header_measures(bytes)
      raise Invalid, "Invalid measure count: #{measures} (expected 1–#{MAX_MEASURES})" unless (1..MAX_MEASURES).cover?(measures)

      raise Invalid, "Time signature numerator must be 4, got #{bytes[202]}" unless bytes[202] == 4
      raise Invalid, "Time signature denominator must be 4, got #{bytes[204]}" unless bytes[204] == 4

      raise Invalid, "String count must be 5, got #{bytes[240]}" unless bytes[240] == 5
      raise Invalid, "Capo must be 0, got #{bytes[241]}" unless bytes[241] == 0

      count = component_count(bytes)
      raise Invalid, "Invalid component count: #{count} (expected 1–#{MAX_COMPONENTS})" unless (1..MAX_COMPONENTS).cover?(count)

      expected_min_size = HEADER_SIZE + count * COMPONENT_SIZE
      raise Invalid, "Truncated file: #{bytes.length} bytes, need at least #{expected_min_size}" unless bytes.length >= expected_min_size
    end

    # Parse fixed header (first 258 bytes)
    def self.parse_header(bytes)
      measures = header_measures(bytes)
      time_sig_num = bytes[202]
      time_sig_den = bytes[204]
      strings = bytes[240]
      capo = bytes[241]
      tracks = bytes[242] + 1  # byte 242 is tracks-1
      component_count = component_count(bytes)

      # Tempo at bytes 206-207 (little-endian short)
      tempo = bytes[206] | (bytes[207] << 8)

      {
        measures: measures,
        time_signature: { numerator: time_sig_num, denominator: time_sig_den },
        tempo: tempo,
        strings: strings,
        capo: capo,
        tracks: tracks,
        component_count: component_count
      }
    end

    # Parse component records (6 bytes each, starting at offset 258)
    # Returns { components: [...], annotations: {...}, chords: [...], ... }
    def self.parse_components(bytes, header)
      count = header[:component_count]
      strings = header[:strings]
      time_sig = header[:time_signature]
      ticks_per_beat = 256 * time_sig[:numerator] / time_sig[:denominator]  # 256 for 4/4
      ticks_per_measure = ticks_per_beat * time_sig[:numerator]  # 1024 for 4/4

      components = []
      annotations = {}
      chords = []
      tempo_changes = []
      time_sig_changes = []
      endings = []

      # Position accumulator (in ticks, where each beat = 256 ticks)
      # TuxGuitar encodes components as: abs_pos = prev_abs_pos + b0*256 + b1
      abs_pos = 0

      (0...count).each do |i|
        offset = HEADER_SIZE + i * COMPONENT_SIZE
        break if offset + 5 >= bytes.length

        b0 = bytes[offset]
        b1 = bytes[offset + 1]
        b2 = bytes[offset + 2]
        b3 = bytes[offset + 3]
        b4 = bytes[offset + 4]
        b5 = bytes[offset + 5]

        # Note types use the low five bits; the two extended control types keep
        # their full byte values so they cannot be confused with note effects.
        type = if [ TYPE_TEMPO_CHANGE, TYPE_ENDING_ALT ].include?(b2)
          b2
        else
          b2 & 0x1F
        end
        fret_code = b2 & 0x1F    # bits 0-4
        effect1 = b3 & 0x1F      # bits 0-4
        dynamic_flag = (b3 >> 5) & 0x01  # bit 5 = annotation flag
        effect2 = b4
        duration = b5

        # Accumulate position (TuxGuitar algorithm)
        abs_pos += (b0 << 8) + b1

        # Decode measure, string, position within measure
        measure = abs_pos / (ticks_per_beat * strings)
        string = (abs_pos / ticks_per_beat) % strings
        position = abs_pos % ticks_per_beat

        case type
        when TYPE_NOTE
          fret = fret_code

          # Handle annotation flag (dynamic_flag from byte 3 bit 5)
          if dynamic_flag == 1
            # Annotation payload is in byte 5 (duration field)
            annotations[components.length] = duration
            fret += duration
            duration = 0  # TuxGuitar clears it
          end

          # Validate fret range
          next unless fret >= 1 && fret <= 25

          components << {
            index: components.length,
            measure: measure,
            position: position,
            string: string,  # 0-based (0 = highest string)
            fret: fret,
            effect1: effect1,
            effect2: effect2,
            duration: duration,
            type: :note
          }

        when TYPE_CHORD
          chords << {
            measure: measure,
            position: position,
            string: string,
            chord_id: duration,
            type: :chord
          }

        when TYPE_TEMPO_CHANGE
          tempo_value = (effect2 << 8) | effect1
          tempo_changes << {
            measure: measure,
            position: position,
            tempo: tempo_value,
            type: :tempo_change
          }

        when TYPE_TIME_SIG_CHANGE
          time_sig_changes << {
            measure: measure,
            position: position,
            numerator: effect2,
            denominator: duration,
            type: :time_sig_change
          }

        when TYPE_ENDING, TYPE_ENDING_ALT
          endings << {
            measure: measure,
            position: position,
            ending_type: type,
            type: :ending
          }
        end
      end

      {
        components: components,
        annotations: annotations,
        chords: chords,
        tempo_changes: tempo_changes,
        time_sig_changes: time_sig_changes,
        endings: endings
      }
    end

    # Parse note data section (after components)
    def self.parse_notes(components_data)
      components_data[:components].map.with_index do |c, idx|
        next unless c[:type] == :note
        {
          index: idx,
          measure: c[:measure],
          position: c[:position],
          string: c[:string],
          fret: c[:fret],
          effect1: c[:effect1],
          effect2: c[:effect2],
          duration: c[:duration],
          annotation: components_data[:annotations][idx]
        }
      end.compact
    end

    # Extract measure count from header (bytes 200-201, little-endian)
    def self.header_measures(bytes)
      bytes[200] | (bytes[201] << 8)
    end

    # Extract component count from header (bytes 256-257, little-endian)
    def self.component_count(bytes)
      bytes[256] | (bytes[257] << 8)
    end
  end
end
