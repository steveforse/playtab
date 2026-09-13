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
end
