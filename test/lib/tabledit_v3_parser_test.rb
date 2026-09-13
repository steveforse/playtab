require "test_helper"

class TableditV3ParserTest < ActiveSupport::TestCase
  test "parses the modern TablEdit layout into the native timeline" do
    parsed = Tef2::TableditV3Parser.parse(modern_tef)

    assert_equal 2, parsed[:measures]
    assert_equal({ numerator: 2, denominator: 4 }, parsed[:time_signature])
    assert_equal [ 65, 62, 57, 50, 69 ], parsed[:tuning]
    assert_equal [ [ 0, 0, 0 ], [ 1, 0, 5 ] ], parsed[:notes].map { |note| [ note[:measure], note[:position], note[:fret] ] }
    assert_equal 64, parsed[:notes].first[:tef2_duration]
    assert_equal 1, parsed[:notes].first[:effect1]
    assert_equal [ 1 ], parsed[:notes].first[:fingerings]
    assert_equal 12, parsed[:notes].second[:effect1]
    assert_equal [ 2 ], Tef2::TableditV3Parser.modern_fingerings(3)
    assert_equal [ "T" ], Tef2::TableditV3Parser.modern_fingerings(6)
    assert_equal [ [ 0, 0, 0, "Section" ] ], parsed[:texts].map { |text| [ text[:measure], text[:position], text[:text_index], text[:text] ] }
    assert_equal [ [ 0, 0, "C min" ] ], parsed[:chords].map { |chord| [ chord[:measure], chord[:position], chord[:name] ] }

    musicxml = Tef2::FullMusicxmlBuilder.build(parsed)
    document = Nokogiri::XML(musicxml)
    assert_equal 2, document.xpath("//part/measure").length
    assert_equal "2", document.at_xpath("//part/measure/attributes/time/beats").text
    assert_equal "4", document.at_xpath("//part/measure/attributes/time/beat-type").text
    assert_equal 4, document.xpath("//hammer-on").length
    assert_equal 2, document.xpath("//bend").length
    assert_equal [ "1" ], document.xpath("//note[staff='2']//fingering").map(&:text)
    assert_empty document.xpath("//technical/notations")
  end

  test "covers TablEdit format guards, tables, readers and duration mappings" do
    refute Tef2::TableditV3Parser.tabledit_v3?(Array.new(10, 0))
    false_magic = Array.new(0xCE, 0); false_magic[0x38, 4] = "nope".bytes
    refute Tef2::TableditV3Parser.tabledit_v3?(false_magic)
    false_format = Array.new(0xCE, 0); false_format[0x38, 4] = "debt".bytes; put_u16(false_format, 0xCC, 9 << 8)
    refute Tef2::TableditV3Parser.tabledit_v3?(false_format)

    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.validate_file!([]) }
    invalid = false_magic.dup; invalid[0x38, 4] = "debt".bytes; put_u16(invalid, 0xCC, 10 << 8); invalid[0x10] = 1
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.validate_file!(invalid) }

    assert_equal [], Tef2::TableditV3Parser.parse_texts(Array.new(0x60, 0))
    text_bytes = Array.new(0x310, 0); put_u32(text_bytes, 0x54, 0x300); put_u16(text_bytes, 0x300, 1); put_u16(text_bytes, 0x302, 4); text_bytes[0x304, 3] = "ABC".bytes
    assert_equal [ "ABC" ], Tef2::TableditV3Parser.parse_texts(text_bytes)
    truncated_text = text_bytes.first(0x305)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse_texts(truncated_text) }

    assert_equal [], Tef2::TableditV3Parser.parse_chords(Array.new(0x60, 0))
    assert_raises(Tef2::TableditV3Parser::Invalid) do
      chord_error = Array.new(0x80, 0); put_u32(chord_error, 0x58, 0x60); put_u16(chord_error, 0x60, 31); put_u16(chord_error, 0x62, 0)
      Tef2::TableditV3Parser.parse_chords(chord_error)
    end

    indirect = Array.new(0x310, 0); put_u32(indirect, 0x40, 0x300); put_u16(indirect, 0x300, 4); indirect[0x302, 3] = "ABC".bytes
    assert_equal "ABC", Tef2::TableditV3Parser.indirect_text(indirect, 0x40)
    assert_equal "", Tef2::TableditV3Parser.indirect_text(Array.new(0x50, 0), 0x40)
    truncated_indirect = [ 0 ] * 0x44; put_u32(truncated_indirect, 0x40, 0xFF)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.indirect_text(truncated_indirect, 0x40) }

    assert_equal [ [], [], [ 1 ], [ 2 ], [ 3 ], [ 4 ], [ "T" ] ], (0..6).map { |value| Tef2::TableditV3Parser.modern_fingerings(value) }
    assert_equal "é", Tef2::TableditV3Parser.decode_text([ 0xE9 ])
    assert_equal "\u0081", Tef2::TableditV3Parser.decode_text([ 0x81 ])
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.duration_ticks(16) }
    assert_equal 1024, Tef2::TableditV3Parser.duration_ticks(0)
    assert_equal 16, Tef2::TableditV3Parser.duration_ticks(17)

    notes = [ { measure: 0, position: 0, tef2_duration: 4 }, { measure: 0, position: 0, tef2_duration: 8 }, { measure: 1, position: 0, tef2_duration: 2 } ]
    assert_equal notes, Tef2::TableditV3Parser.assign_chord_durations(notes)
    assert_equal true, notes[0][:is_chord]
  end

  test "covers TablEdit section and low-level reader failures" do
    measures = [ { length_units: 64 }, { length_units: 64 } ]
    assert_equal [ 1, 0 ], Tef2::TableditV3Parser.locate_measure([ 0, 64, 128 ], 64)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.locate_measure([ 0, 64 ], 64) }

    gap = Array.new(0x220, 0)
    put_u32(gap, 0x3C, 0x200); put_u32(gap, 0x200, 0); gap[0x204] = 0x33; put_u32(gap, 0x20C, 0xFFFFFFFF)
    assert_equal [ [], 1, [], [] ], Tef2::TableditV3Parser.parse_contents(gap, measures, 5)
    truncated = gap.first(0x208)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse_contents(truncated, measures, 5) }

    reader = Tef2::TableditV3Parser::Reader.new([ 255, 1, 2, 3, 4, 5, 4, 0, 65, 66, 67, 0 ], 0)
    assert_equal 255, reader.u8
    assert_equal 1, reader.i8
    assert_equal 770, reader.u16
    assert_equal 4, reader.u8
    assert_equal [ 5, 4 ], reader.bytes(2)
    assert_equal "ABC", Tef2::TableditV3Parser::Reader.new([ 4, 0, 65, 66, 67, 0 ], 0).text
    assert_raises(IndexError) { reader.require!(100) }
    assert_raises(IndexError) { Tef2::TableditV3Parser::Reader.new([ 0, 0 ], -1).require!(1) }
    assert_raises(IndexError) { Tef2::TableditV3Parser::Reader.new([ 0, 0 ], 0).text }
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.read_u16([ 0 ], 0) }
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.read_u32([ 0 ], 0) }

    truncated_measures = Array.new(0x64, 0); put_u32(truncated_measures, 0x5C, 0x63)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse_measures(truncated_measures) }
    truncated_instruments = Array.new(0x68, 0); put_u32(truncated_instruments, 0x60, 0x67)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse_instruments(truncated_instruments) }
    truncated_chords = Array.new(0x80, 0); put_u32(truncated_chords, 0x58, 0x7F)
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse_chords(truncated_chords) }
  end

  private

  def modern_tef
    bytes = Array.new(0x600, 0)
    put_u16(bytes, 0, 16)
    put_u16(bytes, 2, 769)
    put_u16(bytes, 4, 162)
    put_u16(bytes, 6, 100)
    bytes[0x38, 4] = "debt".bytes
    put_u32(bytes, 0x3C, 0x200)
    put_u32(bytes, 0x5C, 0x100)
    put_u32(bytes, 0x60, 0x140)
    put_u16(bytes, 0xCA, 4)
    put_u16(bytes, 0xCC, 0x0A04)

    put_u16(bytes, 0x100, 12)
    put_u16(bytes, 0x102, 2)
    2.times do |index|
      offset = 0x108 + (index * 8)
      bytes[offset, 8] = [ 0, 0, 0, 32, 4, 2, 0, 0 ]
    end

    put_u16(bytes, 0x140, 68)
    put_u16(bytes, 0x142, 1)
    instrument = [ 5, 0, 0, 0, 0, 0, 0, 0, 105, 0, 1, 0, 0, 0, 60, 0, 0, 0, 0, 0 ]
    instrument.concat([ 31, 34, 39, 46, 27 ]).concat(Array.new(7, 0))
    instrument.concat("Banjo".bytes).concat(Array.new(31, 0))
    bytes[0x144, 68] = instrument

    put_u32(bytes, 0x54, 0x300)
    bytes[0x300, 2] = [ 1, 0 ]
    bytes[0x302, 2] = [ 8, 0 ]
    bytes[0x304, 7] = "Section".bytes
    bytes[0x30B] = 0
    put_u32(bytes, 0x58, 0x340)
    put_u16(bytes, 0x340, 36)
    put_u16(bytes, 0x342, 1)
    chord = [ 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255 ]
    chord.concat("C min".bytes, [ 0 ])
    chord.concat(Array.new(11, 0), [ 1 ], Array.new(4, 0))
    bytes[0x344, 36] = chord

    put_u32(bytes, 0x200, 0)
    bytes[0x204, 8] = [ 1, 0x4C, 1, 0, 0, 0, 2, 0 ]
    put_u32(bytes, 0x20C, 0)
    bytes[0x210, 8] = [ 0x35, 0, 0, 0, 0, 0, 0, 0 ]
    put_u32(bytes, 0x218, 0)
    bytes[0x21C, 8] = [ 0x39, 0, 0, 0, 0, 0, 0, 0 ]
    put_u32(bytes, 0x224, 32 * 5 * 8)
    bytes[0x228, 8] = [ 6, 0x4C, 12, 0, 0, 0, 0, 0 ]
    put_u32(bytes, 0x230, 0xFFFFFFFF)
    bytes.pack("C*")
  end

  def put_u16(bytes, offset, value)
    bytes[offset, 2] = [ value & 0xFF, (value >> 8) & 0xFF ]
  end

  def put_u32(bytes, offset, value)
    bytes[offset, 4] = [ value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF ]
  end

  def put_u16(bytes, offset, value)
    bytes[offset, 2] = [ value & 0xFF, (value >> 8) & 0xFF ]
  end
end
