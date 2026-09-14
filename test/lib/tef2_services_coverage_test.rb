require "test_helper"

class Tef2ServicesCoverageTest < ActiveSupport::TestCase
  test "converts through the full native parser and reports metadata warnings" do
    parsed = {
      notes: [ { fret: 0 } ], annotations: { 0 => 9 },
      track_data: [ { capo: 2 } ], repeats: [ { start: 1, length: 2 } ]
    }
    Tef2::TableditV3Parser.stub(:tabledit_v3?, false) do
      Tef2::FullParser.stub(:parse, parsed) do
        Tef2::FullMusicxmlBuilder.stub(:build, "<score-partwise/>") do
          result = Tef2.try_full_parse("bytes")
          assert_equal "<score-partwise/>", result[:musicxml]
          assert_equal 4, result[:warnings].length
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

  test "uses the converter and fallback parser paths" do
    client = Object.new
    client.define_singleton_method(:convert) { |_bytes| { "musicxml" => "xml", "warnings" => [] } }
    client.define_singleton_method(:stop!) { nil }
    Tef2::ConverterClient.stub(:new, client) do
      assert_equal "xml", Tef2.try_converter_service("bytes")["musicxml"]
    end
    invalid_client = Object.new
    invalid_client.define_singleton_method(:convert) { |_bytes| raise Tef2::ConverterClient::Invalid, "bad" }
    invalid_client.define_singleton_method(:stop!) { nil }
    Tef2::ConverterClient.stub(:new, invalid_client) do
      assert_raises(Tef2::Invalid) { Tef2.try_converter_service("bytes") }
    end
    unavailable_client = Object.new
    unavailable_client.define_singleton_method(:convert) { |_bytes| raise Tef2::ConverterClient::Unavailable, "down" }
    unavailable_client.define_singleton_method(:stop!) { nil }
    Tef2::ConverterClient.stub(:new, unavailable_client) do
      assert_raises(Tef2::Unavailable) { Tef2.try_converter_service("bytes") }
    end

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
      Tef2.stub(:try_converter_service, ->(*) { raise Tef2::Unavailable, "down" }) do
        Tef2::Parser.stub(:parse, ->(*) { raise Tef2::Parser::Invalid, "bad" }) do
          assert_raises(Tef2::Invalid) { Tef2.convert("bytes") }
        end
      end
    end

    Tef2.stub(:try_full_parse, nil) do
      Tef2.stub(:try_converter_service, ->(*) { raise Tef2::Unavailable, "down" }) do
        Tef2::Parser.stub(:parse, { measures: 1, components: [], annotations: {} }) do
          Tef2::Timeline.stub(:build, []) do
            Tef2::MusicXmlBuilder.stub(:build, "xml") do
              assert_equal "xml", Tef2.convert("bytes")[:musicxml]
            end
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
    Tef2.stub(:convert, ->(*) { raise Tef2::Unavailable, "unavailable" }) do
      assert_raises(TefConverter::Unavailable) { TefConverter.convert("bytes") }
    end
    Tef2.stub(:convert, ->(*) { raise Tef2::Error, "broken" }) do
      error = assert_raises(TefConverter::Unavailable) { TefConverter.convert("bytes") }
      assert_equal "TEF conversion failed: broken", error.message
    end

    client = Object.new
    client.define_singleton_method(:convert_pdf) { |_bytes| { "musicxml" => "pdf xml", "warnings" => [] } }
    client.define_singleton_method(:stop!) { nil }
    Tef2::ConverterClient.stub(:new, client) do
      assert_equal({ "musicxml" => "pdf xml", "warnings" => [] }, PdfConverter.convert("pdf"))
    end
    assert_raises(PdfConverter::Invalid) { PdfConverter.convert("") }
    invalid_pdf_client = Object.new
    invalid_pdf_client.define_singleton_method(:convert_pdf) { |_bytes| raise Tef2::ConverterClient::Invalid, "bad PDF" }
    invalid_pdf_client.define_singleton_method(:stop!) { nil }
    Tef2::ConverterClient.stub(:new, invalid_pdf_client) do
      assert_raises(PdfConverter::Invalid) { PdfConverter.convert("pdf") }
    end
    unavailable_pdf_client = Object.new
    unavailable_pdf_client.define_singleton_method(:convert_pdf) { |_bytes| raise Tef2::ConverterClient::Unavailable, "down" }
    unavailable_pdf_client.define_singleton_method(:stop!) { nil }
    Tef2::ConverterClient.stub(:new, unavailable_pdf_client) do
      assert_raises(PdfConverter::Unavailable) { PdfConverter.convert("pdf") }
    end
    [
      { "musicxml" => "", "warnings" => [] },
      { "musicxml" => "x" * 2_000_001, "warnings" => [] },
      { "musicxml" => "xml", "warnings" => "bad" }
    ].each do |response|
      response_client = Object.new
      response_client.define_singleton_method(:convert_pdf) { |_bytes| response }
      response_client.define_singleton_method(:stop!) { nil }
      Tef2::ConverterClient.stub(:new, response_client) do
        assert_raises(PdfConverter::Unavailable) { PdfConverter.convert("pdf") }
      end
    end
  end

  test "covers converter client responses and lifecycle" do
    client = Tef2::ConverterClient.new(port: 1234, converter_script: "server.py", base_url: nil)
    assert_equal 1234, client.instance_variable_get(:@port)
    assert_equal "server.py", client.instance_variable_get(:@converter_script)

    success = http_response(Net::HTTPOK, { "musicxml" => "xml", "warnings" => [] }.to_json)
    http = fake_http(success)
    client.stub(:ensure_running!, nil) do
      Net::HTTP.stub(:new, http) do
        assert_equal({ "musicxml" => "xml", "warnings" => [] }, client.convert("bytes"))
        assert_equal({ "musicxml" => "xml", "warnings" => [] }, client.convert_pdf("bytes"))
      end
    end

    failed = http_response(Net::HTTPBadRequest, { "error" => "bad" }.to_json)
    client.stub(:ensure_running!, nil) do
      Net::HTTP.stub(:new, fake_http(failed)) do
        assert_raises(Tef2::ConverterClient::Invalid) { client.convert("bytes") }
      end
    end

    invalid = http_response(Net::HTTPOK, { "musicxml" => nil, "warnings" => [] }.to_json)
    client.stub(:ensure_running!, nil) do
      Net::HTTP.stub(:new, fake_http(invalid)) do
        assert_raises(Tef2::ConverterClient::Unavailable) { client.convert("bytes") }
      end
    end

    client.stub(:ensure_running!, nil) do
      Net::HTTP.stub(:new, ->(*) { raise IOError, "offline" }) do
        error = assert_raises(Tef2::ConverterClient::Unavailable) { client.convert("bytes") }
        assert_match(/unavailable/, error.message)
      end
    end
  end

  test "covers converter client startup, stopping and health checks" do
    client = Tef2::ConverterClient.new(base_url: nil)
    client.instance_variable_set(:@pid, 123)
    Process.stub(:kill, 0) { assert client.running? }
    Process.stub(:kill, ->(*) { raise Errno::ESRCH }) { refute client.running? }

    client.instance_variable_set(:@pid, 123)
    Process.stub(:kill, 0) do
      Process.stub(:wait, 123) do
        client.stop!
        assert_nil client.instance_variable_get(:@pid)
      end
    end
    client.instance_variable_set(:@pid, 123)
    Process.stub(:kill, ->(*) { raise Errno::ECHILD }) { client.stop!; assert_nil client.instance_variable_get(:@pid) }
    client.stop!

    ready = Tef2::ConverterClient.new(base_url: nil)
    ready.stub(:running?, true) { assert_nil ready.ensure_running! }
    ready.stub(:running?, false) do
      ready.stub(:spawn_python_server, 456) do
        ready.stub(:wait_for_ready, nil) { assert_nil ready.ensure_running! }
      end
    end
    failed = Tef2::ConverterClient.new(base_url: nil)
    failed.stub(:running?, false) do
      failed.stub(:spawn_python_server, -> { raise "boom" }) do
        failed.stub(:stop!, nil) do
          error = assert_raises(Tef2::ConverterClient::Unavailable) { failed.ensure_running! }
          assert_match(/Failed to start/, error.message)
        end
      end
    end

    waiting = Tef2::ConverterClient.new(base_url: nil)
    calls = 0
    waiting.stub(:health_check, -> { calls += 1; calls >= 3 }) do
      waiting.stub(:sleep, nil) { waiting.send(:wait_for_ready) }
    end
    assert_equal 3, calls

    down = Tef2::ConverterClient.new(base_url: nil)
    down.stub(:health_check, false) do
      current_time = Time.now
      calls = 0
      Time.stub(:now, -> { calls += 1; calls == 1 ? current_time : current_time + 11 }) do
        assert_raises(Tef2::ConverterClient::Unavailable) { down.send(:wait_for_ready) }
      end
    end

    http = fake_http(Net::HTTPOK.new("1.1", "200", "OK"))
    client.stub(:health_check, true) { assert client.send(:health_check) }
    Net::HTTP.stub(:new, http) { assert client.send(:health_check) }
    http.stub(:get, ->(*) { raise SocketError, "offline" }) { refute client.send(:health_check) }

    remote = Tef2::ConverterClient.new(base_url: "http://converter:8080")
    assert_nil remote.ensure_running!
    remote.stop!
  end

  test "spawns the converter with detached standard streams" do
    client = Tef2::ConverterClient.new(converter_script: "server.py", base_url: nil)
    Process.stub(:spawn, ->(*args) {
      options = args.pop
      assert_equal [ "python3", "server.py" ], args
      assert_equal "/dev/null", options[:in]
      assert_equal "/dev/null", options[:out]
      assert_equal "/dev/null", options[:err]
      assert_equal true, options[:pgroup]
      987
    }) do
      assert_equal 987, client.send(:spawn_python_server)
    end
  end

  private

  def fake_http(response)
    http = Object.new
    http.define_singleton_method(:open_timeout=) { |_value| }
    http.define_singleton_method(:read_timeout=) { |_value| }
    http.define_singleton_method(:write_timeout=) { |_value| }
    http.define_singleton_method(:request) { |_request| response }
    http.define_singleton_method(:get) { |_path| response }
    http
  end

  def http_response(klass, body)
    response = klass.new("1.1", klass == Net::HTTPOK ? "200" : "400", klass == Net::HTTPOK ? "OK" : "Bad Request")
    response.define_singleton_method(:body) { body }
    response
  end
end
