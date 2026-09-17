require "test_helper"

class Tef2ServicesCoverageTest < ActiveSupport::TestCase
  test "converts through the full native parser and reports metadata warnings" do
    parsed = {
      notes: [ { fret: 0 } ], annotations: { 0 => 9 },
      measures: 5, track_data: [ { capo: 2 } ], repeats: [ { start: 1, length: 2 } ]
    }
    Tef2::TableditV3Parser.stub(:tabledit_v3?, false) do
      Tef2::FullParser.stub(:parse, parsed) do
        Tef2::FullMusicxmlBuilder.stub(:build, "<score-partwise/>") do
          result = Tef2.try_full_parse("bytes")
          assert_equal "<score-partwise/>", result[:musicxml]
          # The repeat table entry decodes fully, so no repeat warning.
          assert_equal 3, result[:warnings].length
        end
      end
    end
  end

  test "warns when repeat-table entries remain undecoded" do
    parsed = {
      notes: [ { fret: 0 } ], annotations: {},
      measures: 23, track_data: [], repeats: [ { start: 17, length: 17 } ]
    }
    Tef2::TableditV3Parser.stub(:tabledit_v3?, false) do
      Tef2::FullParser.stub(:parse, parsed) do
        Tef2::FullMusicxmlBuilder.stub(:build, "<score-partwise/>") do
          result = Tef2.try_full_parse("bytes")
          assert_includes result[:warnings], "TEF2 repeat table entry (17, 17) was not decoded; no repeat was added."
          assert_includes result[:warnings], "Some TEF2 repeat-map entries were not decoded; the imported score follows the source's written measures once."
        end
      end
    end
  end

  test "reports suppressed annotation codes and keeps unknown-code labels" do
    parsed = {
      notes: [ { fret: 0 } ], annotations: { 0 => 1, 1 => 198 },
      measures: 2, track_data: [], repeats: []
    }
    Tef2::TableditV3Parser.stub(:tabledit_v3?, false) do
      Tef2::FullParser.stub(:parse, parsed) do
        Tef2::FullMusicxmlBuilder.stub(:build, "<score-partwise/>") do
          result = Tef2.try_full_parse("bytes")
          assert_includes result[:warnings], "TEF annotation codes with no visible TefView rendering are omitted: 1, 198."
          refute_includes result[:warnings], "TEF fingering codes without a known finger mapping are shown as TEF code labels."
        end
      end
    end
  end

  test "reports unsupported effect codes while retaining the native conversion" do
    parsed = {
      notes: [ { fret: 0, effect1: 64, effect2: 14, effect3: 12 } ], annotations: {},
      track_data: [ { capo: 0 } ], repeats: []
    }
    Tef2::TableditV3Parser.stub(:tabledit_v3?, false) do
      Tef2::FullParser.stub(:parse, parsed) do
        Tef2::FullMusicxmlBuilder.stub(:build, "<score-partwise/>") do
          result = Tef2.try_full_parse("bytes")
          assert_includes result[:warnings], "Unsupported TEF effect codes are preserved as TEF technical metadata: effect1=64, effect2=14, effect3=12."
        end
      end
    end
  end

  test "returns nil for unexpected full parser failures and preserves parser errors" do
    Tef2::TableditV3Parser.stub(:tabledit_v3?, false) do
      Tef2::FullParser.stub(:parse, ->(*) { raise RuntimeError, "unexpected" }) do
        assert_nil Tef2.try_full_parse("bytes")
      end
      Tef2::FullParser.stub(:parse, ->(*) { raise Tef2::FullParser::Invalid, "bad" }) do
        assert_raises(Tef2::FullParser::Invalid) { Tef2.try_full_parse("bytes") }
      end
    end
  end

  test "uses the simple native parser fallback path" do
    parsed = { measures: 1, components: [], annotations: {} }
    Tef2::Parser.stub(:parse, parsed) do
      Tef2::Timeline.stub(:build, []) do
        Tef2::MusicXmlBuilder.stub(:build, "xml") do
          result = Tef2.try_native_parse("bytes")
          assert_equal "xml", result[:musicxml]
        end
      end
    end
  end

  test "maps native conversion errors and warning validation" do
    Tef2.stub(:try_full_parse, nil) do
      Tef2::Parser.stub(:parse, ->(*) { raise Tef2::Parser::Invalid, "bad" }) do
        assert_raises(Tef2::Invalid) { Tef2.convert("bytes") }
      end
    end

    Tef2.stub(:try_full_parse, nil) do
      Tef2::Parser.stub(:parse, { measures: 1, components: [], annotations: {} }) do
        Tef2::Timeline.stub(:build, []) do
          Tef2::MusicXmlBuilder.stub(:build, "xml") do
            assert_equal "xml", Tef2.convert("bytes")[:musicxml]
          end
        end
      end
    end

    Tef2.stub(:convert, { musicxml: "xml", warnings: [ "warn" ] }) do
      assert_equal({ "musicxml" => "xml", "warnings" => [ "warn" ] }, TefConverter.convert("bytes"))
    end
    Tef2.stub(:convert, { musicxml: "", warnings: [] }) do
      assert_raises(TefConverter::Unavailable) { TefConverter.convert("bytes") }
    end
    Tef2.stub(:convert, { musicxml: "x" * 2_000_001, warnings: [] }) do
      assert_raises(TefConverter::Unavailable) { TefConverter.convert("bytes") }
    end
    Tef2.stub(:convert, { musicxml: "xml", warnings: "bad" }) do
      assert_raises(TefConverter::Unavailable) { TefConverter.convert("bytes") }
    end
    Tef2.stub(:convert, ->(*) { raise Tef2::Invalid, "invalid" }) do
      assert_raises(TefConverter::Invalid) { TefConverter.convert("bytes") }
    end
    Tef2.stub(:convert, ->(*) { raise Tef2::Error, "broken" }) do
      error = assert_raises(TefConverter::Unavailable) { TefConverter.convert("bytes") }
      assert_equal "TEF conversion failed: broken", error.message
    end

    score = { warnings: [] }
    Tef2::PdfRecognizer.stub(:recognize, score) do
      Tef2::PdfMusicxmlBuilder.stub(:build, "pdf xml") do
        assert_equal({ "musicxml" => "pdf xml", "warnings" => [] }, PdfConverter.convert("pdf", filename: "score.pdf"))
      end
    end
    assert_raises(PdfConverter::Invalid) { PdfConverter.convert("") }
    Tef2::PdfRecognizer.stub(:recognize, ->(*) { raise Tef2::PdfRecognizer::Error, "bad PDF" }) do
      assert_raises(PdfConverter::Invalid) { PdfConverter.convert("pdf") }
    end
    Tef2::PdfRecognizer.stub(:recognize, score) do
      Tef2::PdfMusicxmlBuilder.stub(:build, ->(*) { raise "builder broken" }) do
        error = assert_raises(PdfConverter::Unavailable) { PdfConverter.convert("pdf") }
        assert_equal "PDF conversion failed: builder broken", error.message
      end
    end
    [
      { "musicxml" => "", "warnings" => [] },
      { "musicxml" => "x" * 2_000_001, "warnings" => [] },
      { "musicxml" => "xml", "warnings" => "bad" }
    ].each do |response|
      Tef2::PdfRecognizer.stub(:recognize, { warnings: response["warnings"] }) do
        Tef2::PdfMusicxmlBuilder.stub(:build, response["musicxml"]) do
          assert_raises(PdfConverter::Unavailable) { PdfConverter.convert("pdf") }
        end
      end
    end
  end
end
