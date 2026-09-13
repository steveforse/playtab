require "test_helper"

class Tef2ParserCoverageTest < ActiveSupport::TestCase
  test "parses legacy headers, notes, annotations and control components" do
    bytes = parser_bytes(7)
    components = [
      [ 0, 0, 1, 1, 2, 1 ],
      [ 0, 0, 0x22, 0x21, 3, 2 ],
      [ 0, 0, 28, 0, 0, 7 ],
      [ 0, 0, 254, 0x34, 1, 0 ],
      [ 0, 0, 27, 0, 3, 4 ],
      [ 0, 0, 30, 0, 0, 0 ],
      [ 0, 0, 94, 0, 0, 0 ]
    ]
    components.each_with_index { |component, index| bytes[258 + index * 6, 6] = component }

    parsed = Tef2::Parser.parse(bytes.pack("C*"))

    assert_equal 1, parsed[:measures]
    assert_equal 2, parsed[:notes].length
    assert_equal 4, parsed[:notes].second[:fret]
    assert_equal 2, parsed[:annotations][1]
    assert_equal 1, parsed[:chords].length
    assert_equal 1, parsed[:tempo_changes].length
    assert_equal 1, parsed[:time_sig_changes].length
    assert_equal [ 30, 94 ], parsed[:endings].map { |ending| ending[:ending_type] }
  end

  test "validates every legacy header limit" do
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!([]) }
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(Array.new(100_001, 0)) }

    invalid = parser_bytes(1)
    put_u16(invalid, 200, 0)
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(1); invalid[202] = 3
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(1); invalid[204] = 8
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(1); invalid[240] = 4
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(1); invalid[241] = 1
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(0)
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(1); put_u16(invalid, 256, 8193)
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }
    invalid = parser_bytes(1); invalid.slice!(258, 6)
    assert_raises(Tef2::Parser::Invalid) { Tef2::Parser.validate_header!(invalid) }

    header = Tef2::Parser.parse_header(parser_bytes(1))
    assert_equal({ measures: 1, numerator: 4, denominator: 4 }, { measures: header[:measures], numerator: header[:time_signature][:numerator], denominator: header[:time_signature][:denominator] })
    assert_equal 1, header[:tracks]
    assert_equal 1, header[:component_count]
  end

  test "parses invalid components, notes and helper values" do
    bytes = parser_bytes(2)
    bytes[258, 6] = [ 0, 0, 0, 0, 0, 0 ]
    bytes[264, 6] = [ 0, 0, 1, 0, 0, 0 ]
    parsed = Tef2::Parser.parse_components(bytes, Tef2::Parser.parse_header(bytes))
    assert_equal 1, parsed[:components].length
    assert_equal [ 0 ], Tef2::Parser.parse_notes(parsed).map { |note| note[:index] }
    assert_equal 1, Tef2::Parser.header_measures(bytes)
    assert_equal 2, Tef2::Parser.component_count(bytes)
    partial = Tef2::Parser.parse_components(bytes.first(263), Tef2::Parser.parse_header(bytes).merge(component_count: 2))
    assert_equal 0, partial[:components].length
  end

  private

  def parser_bytes(component_count)
    bytes = Array.new(258 + component_count * 6, 0)
    put_u16(bytes, 200, 1)
    bytes[202] = 4
    bytes[204] = 4
    put_u16(bytes, 206, 120)
    bytes[240] = 5
    bytes[241] = 0
    put_u16(bytes, 256, component_count)
    bytes
  end

  def put_u16(bytes, offset, value)
    bytes[offset, 2] = [ value & 0xFF, (value >> 8) & 0xFF ]
  end
end
