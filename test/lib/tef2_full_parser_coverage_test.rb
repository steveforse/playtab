require "test_helper"

class Tef2FullParserCoverageTest < ActiveSupport::TestCase
  test "parses a complete legacy tail with text, chord, lyrics and track metadata" do
    bytes = complete_file
    parsed = Tef2::FullParser.parse(bytes)

    assert_equal 1, parsed[:measures]
    assert_equal [ 63, 60, 55, 50, 67 ], parsed[:tuning]
    assert_equal "Verse", parsed[:texts].first[:text]
    assert_equal "C", parsed[:chords].first[:name]
    assert_equal "LYR", parsed[:lyrics_text]
    assert_equal({ start: 0, length: 1 }, parsed[:repeats].first)
    assert_equal 2, parsed[:notes].length
    assert_equal true, parsed[:notes].second[:is_chord]
    assert_equal false, parsed[:track_data].first[:percussion]
  end

  test "validates full parser headers and parse-level track constraints" do
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!([]) }
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(Array.new(100_001, 0)) }
    invalid = full_header(1)
    put_u16(invalid, 200, 0)
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(invalid) }
    invalid = full_header(1); invalid[202] = 0
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(invalid) }
    invalid = full_header(1); invalid[204] = 3
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(invalid) }
    invalid = full_header(1); invalid[240] = 4
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(invalid) }
    invalid = full_header(1); put_u16(invalid, 256, 0)
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(invalid) }
    invalid = full_header(1); invalid.slice!(258, 6)
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.validate_header!(invalid) }

    base = full_header(1)
    empty_components = { notes: [ { fret: 0 } ], texts: [], chords: [], tempo_changes: [], time_sig_changes: [], endings: [], annotations: {} }
    empty_tail = { texts: [], chords: [], lyrics_text: nil, tracks: [], repeats: [], percussions: [], rhythms: [] }
    Tef2::FullParser.stub(:parse_components, empty_components) do
      Tef2::FullParser.stub(:parse_tail, empty_tail) do
        assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.parse(base) }
      end
    end

    two_tracks = full_header(1)
    two_tracks[241] = 1
    two_track_tail = empty_tail.merge(tracks: [ { tuning: [ 1, 2, 3, 4, 5 ], percussion: false }, { tuning: [ 1, 2, 3, 4, 5 ], percussion: false } ])
    Tef2::FullParser.stub(:parse_components, empty_components) do
      Tef2::FullParser.stub(:parse_tail, two_track_tail) do
        assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.parse(two_tracks) }
      end
    end

    cases = [
      { tuning: [ 1, 2, 3, 4 ], percussion: false },
      { tuning: [ 1, 2, 3, 4, 5 ], percussion: true }
    ]
    cases.each do |track|
      Tef2::FullParser.stub(:parse_components, empty_components) do
        Tef2::FullParser.stub(:parse_tail, empty_tail.merge(tracks: [ track ])) do
          assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.parse(base) }
        end
      end
    end
  end

  test "covers component decoding, duration and metadata helpers" do
    header = { measures: 2, strings: 5, time_signature: { numerator: 4, denominator: 4 }, component_count: 7 }
    bytes = Array.new(258 + 7 * 6, 0)
    records = [
      [ 0, 0, 0x21, 0, 0, 0 ],
      [ 0, 0, 0x22, 0x20, 1, 4 ],
      [ 0, 0, 28, 3, 0, 0 ],
      [ 0, 0, 29, 4, 0, 0 ],
      [ 0, 0, 254, 90, 1, 0 ],
      [ 0, 0, 30, 0, 0, 0 ],
      [ 0, 0, 94, 0, 0, 0 ]
    ]
    records.each_with_index { |record, index| bytes[258 + index * 6, 6] = record }
    parsed = Tef2::FullParser.parse_components(bytes, header)
    assert_equal 2, parsed[:notes].length
    assert_equal 4, parsed[:annotations][1]
    assert_equal [ 3 ], parsed[:chords].map { |chord| chord[:chord_id] }
    assert_equal [ 4 ], parsed[:texts].map { |text| text[:text_id] }
    assert_equal [ 346 ], parsed[:tempo_changes].map { |change| change[:tempo] }
    assert_equal [ 30, 94 ], parsed[:endings].map { |ending| ending[:ending_type] }

    assert_equal [ 1024, 768, 683, 384, 341, 192, 171, 96, 85, 48, 43, 21, 896, 448, 224, 112, 48, 43 ],
      [ 0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 17, 19, 22, 25, 28, 31, 20 ].map { |code| Tef2::FullParser.duration_ticks(code) }
    assert_equal 16, Tef2::FullParser.duration_ticks(21)
    assert_equal [ { numerator: 4, denominator: 4 }, { numerator: 3, denominator: 4 } ],
      Tef2::FullParser.measure_signatures({ measures: 2, time_signature: { numerator: 4, denominator: 4 } }, [ { measure: 1, numerator: 3, denominator: 4 } ])
    assert_equal [ { numerator: 4, denominator: 4 } ],
      Tef2::FullParser.measure_signatures({ measures: 1, time_signature: { numerator: 4, denominator: 4 } }, [ { measure: 2, numerator: 3, denominator: 4 }, { measure: 0, numerator: 0, denominator: 4 } ])

    notes = [
      { measure: 0, position: 0, tef2_duration: 8, annotation: 2 },
      { measure: 0, position: 8, tef2_duration: 4 },
      { measure: 0, position: 0, tef2_duration: 16 }
    ]
    Tef2::FullParser.assign_chord_durations(notes)
    Tef2::FullParser.infer_annotation_durations(notes, 1)
    assert_equal 8, notes.first[:tef2_duration]
    assert_equal true, notes.first[:is_chord]
  end

  test "covers parse tail failures and text decoding" do
    header = { component_count: 0, repeats: 1, texts: 0, percussions: 0, chords: 0, rhythms: 0, has_notes: false, tracks: 0, measures: 1 }
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.parse_tail(Array.new(258), header) }
    header = { component_count: 0, repeats: 0, texts: 1, percussions: 0, chords: 0, rhythms: 0, has_notes: false, tracks: 0, measures: 1 }
    assert_raises(Tef2::FullParser::Invalid) { Tef2::FullParser.parse_tail(Array.new(258), header) }
    assert_equal 258, Tef2::FullParser.read_short([ 2, 1 ], 0)
    assert_equal "hello", Tef2::FullParser.decode_text("hello".bytes)
    assert_equal "é", Tef2::FullParser.decode_text([ 0xE9 ])
    assert_equal "\u0081", Tef2::FullParser.decode_text([ 0x81 ])
    assert_equal 1, Tef2::FullParser.header_measures(full_header(1))
    assert_equal 1, Tef2::FullParser.component_count(full_header(1))
  end

  test "uses unanchored text values and handles wrapped component positions" do
    header = { measures: 2, strings: 5, time_signature: { numerator: 4, denominator: 4 }, component_count: 2 }
    bytes = Array.new(258 + 2 * 6, 0)
    bytes[258, 12] = [ 0, 5, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0 ]
    parsed = Tef2::FullParser.parse_components(bytes, header)
    assert_equal [ 1, 51 ], parsed[:notes].map { |note| note[:measure] }

    base = full_header(1)
    components = { notes: [], texts: [], chords: [], tempo_changes: [], time_sig_changes: [], endings: [], annotations: {} }
    tail = { texts: [ "\0", "\0Fallback" ], chords: [], lyrics_text: nil, tracks: [ { tuning: [ 1, 2, 3, 4, 5 ], percussion: false } ], repeats: [], percussions: [], rhythms: [] }
    Tef2::FullParser.stub(:parse_components, components) do
      Tef2::FullParser.stub(:parse_tail, tail) do
        assert_equal "Fallback", Tef2::FullParser.parse(base)[:texts].first[:text]
      end
    end
  end

  private

  def complete_file
    bytes = full_header(4, length: 1_000)
    bytes[222] = 1
    bytes[228] = 1
    bytes[234] = 1
    bytes[235] = 1
    bytes[236] = 1
    bytes[238] = 1
    records = [
      [ 0, 0, 1, 0, 0, 0 ],
      [ 0, 1, 1, 0, 0, 0 ],
      [ 0, 0, 29, 0, 0, 0 ],
      [ 0, 0, 28, 0, 0, 0 ]
    ]
    records.each_with_index { |record, index| bytes[258 + index * 6, 6] = record }
    offset = 282
    bytes[offset, 2] = [ 0, 1 ]; offset += 2
    bytes[offset] = 5; bytes[offset + 1, 5] = "Verse".bytes; bytes[offset + 6] = 0; offset += 7
    offset += 109
    chord = Array.new(32, 0)
    chord[0] = 0xFF; chord[14] = "C".ord
    bytes[offset, 32] = chord; offset += 32
    offset += 109
    bytes[offset, 2] = [ 3, 0 ]; bytes[offset + 2, 3] = "LYR".bytes; bytes[offset + 5] = 0; offset += 5
    bytes[offset] = 5; offset += 6
    bytes[offset] = 0; offset += 2
    bytes[offset] = 105; offset += 4
    bytes[offset] = 0; offset += 2
    bytes[offset, 2] = [ 0, 0 ]; offset += 3
    bytes[offset, 3] = [ 0, 100, 1 ]; offset += 3
    bytes[offset, 5] = [ 33, 36, 41, 46, 29 ]; offset += 12
    bytes[offset, 5] = "Banjo".bytes
    bytes
  end

  def full_header(component_count, length: 258 + component_count * 6)
    bytes = Array.new(length, 0)
    put_u16(bytes, 200, 1)
    bytes[202] = 4
    bytes[204] = 4
    put_u16(bytes, 220, 120)
    bytes[240] = 5
    bytes[241] = 0
    put_u16(bytes, 256, component_count)
    bytes
  end

  def put_u16(bytes, offset, value)
    bytes[offset, 2] = [ value & 0xFF, (value >> 8) & 0xFF ]
  end
end
