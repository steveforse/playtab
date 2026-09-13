require "test_helper"

class Tef2FullParserTest < ActiveSupport::TestCase
  test "decodes a TEF2 time signature change and exposes measure signatures" do
    header = {
      measures: 2,
      time_signature: { numerator: 2, denominator: 4 },
      strings: 5,
      component_count: 2
    }
    bytes = Array.new(Tef2::FullParser::HEADER_SIZE + (header[:component_count] * Tef2::FullParser::COMPONENT_SIZE), 0)
    bytes[258, 6] = [ 0, 0, 1, 12, 0, 0 ]
    bytes[264, 6] = [ 128, 2, 123, 16, 0, 0 ]

    components = Tef2::FullParser.parse_components(bytes, header)

    assert_equal({ measure: 1, position: 0, numerator: 1, denominator: 4, type: :time_sig_change }, components[:time_sig_changes].first)
    assert_equal [ { numerator: 2, denominator: 4 }, { numerator: 1, denominator: 4 } ],
      Tef2::FullParser.measure_signatures(header, components[:time_sig_changes])
  end

  test "keeps TEF text component positions and text table indexes" do
    header = {
      measures: 2,
      time_signature: { numerator: 4, denominator: 4 },
      strings: 5,
      component_count: 2
    }
    bytes = Array.new(Tef2::FullParser::HEADER_SIZE + (header[:component_count] * Tef2::FullParser::COMPONENT_SIZE), 0)
    bytes[258, 6] = [ 0, 0, 29, 0, 0, 0 ]
    bytes[264, 6] = [ 0, 5, 29, 3, 0, 0 ]

    components = Tef2::FullParser.parse_components(bytes, header)

    assert_equal [
      { measure: 0, position: 0, string: 0, text_id: 0, type: :text },
      { measure: 1, position: 0, string: 0, text_id: 3, type: :text }
    ], components[:texts]
  end
end
