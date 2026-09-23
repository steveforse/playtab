require "test_helper"

class TefImportsTest < ActionDispatch::IntegrationTest
  setup { sign_in_as(User.first) }

  test "missing and invalid TEF uploads are rejected without saving songs" do
    assert_no_difference("Song.count") do
      post api_tef_imports_url, params: {}, as: :json
      assert_response :unprocessable_entity
      Tempfile.create([ "invalid", ".tef" ]) do |file|
        file.write("not a TEF")
        file.flush
        post api_tef_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "application/octet-stream") }
        assert_response :unprocessable_entity
        assert_match(/incomplete|invalid/, response.parsed_body["error"])
      end
    end
  end

  test "oversized uploads are rejected" do
    Tempfile.create([ "large", ".tef" ]) do |file|
      file.write("x" * 100_001)
      file.flush
      post api_tef_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "application/octet-stream") }
      assert_response :content_too_large
    end
  end

  test "rejects an oversized request before reading the upload" do
    post api_tef_imports_url, params: { padding: "x" * 111_000 }, as: :json
    assert_response :content_too_large
  end

  test "invalid TEF2 header is rejected" do
    Tempfile.create([ "test", ".tef" ]) do |file|
      file.binmode
      file.write("\0" * 300)
      file.flush
      post api_tef_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "application/octet-stream") }
      assert_response :unprocessable_entity
      assert_match(/measure count/, response.parsed_body["error"])
    end
  end

  test "rejects the wrong extension and reports an unavailable TEF conversion" do
    Tempfile.create([ "text", ".txt" ]) do |file|
      file.write("x" * 300)
      file.flush
      post api_tef_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "text/plain") }
      assert_response :unprocessable_entity
      assert_equal "Choose a .tef file.", response.parsed_body["error"]
    end

    Tempfile.create([ "valid", ".tef" ]) do |file|
      file.binmode
      file.write("x" * 300)
      file.flush
      TefConverter.stub(:convert, ->(*) { raise TefConverter::Unavailable, "converter down" }) do
        post api_tef_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "application/octet-stream") }
      end
      assert_response :service_unavailable
      assert_equal "converter down", response.parsed_body["error"]
    end
  end

  test "converts a PDF upload through the bounded recognizer" do
    result = { "musicxml" => '<score-partwise version="3.1"></score-partwise>', "warnings" => [ "timing inferred" ] }
    PdfConverter.stub(:convert, result) do
      Tempfile.create([ "score", ".pdf" ]) do |file|
        file.binmode
        file.write("%PDF-1.7 synthetic")
        file.flush
        post api_pdf_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "application/pdf") }
      end
    end
    assert_response :success
    assert_equal result, response.parsed_body
  end

  test "rejects non-PDF uploads and oversized PDF requests" do
    post api_pdf_imports_url, params: {}, as: :json
    assert_response :unprocessable_entity
    assert_equal "Choose a .pdf file.", response.parsed_body["error"]

    Tempfile.create([ "score", ".txt" ]) do |file|
      file.write("x")
      file.flush
      post api_pdf_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "text/plain") }
    end
    assert_response :unprocessable_entity
    assert_equal "Choose a .pdf file.", response.parsed_body["error"]

    post api_pdf_imports_url, params: { padding: "x" * 10_100_001 }, as: :json
    assert_response :content_too_large

    Tempfile.create([ "large", ".pdf" ]) do |file|
      file.binmode
      file.write("x" * 10_000_001)
      file.flush
      post api_pdf_imports_url, params: { file: Rack::Test::UploadedFile.new(file.path, "application/pdf") }
    end
    assert_response :content_too_large
  end

  test "maps PDF recognizer failures to safe responses" do
    Tempfile.create([ "score", ".pdf" ]) do |file|
      file.write("%PDF-1.7 synthetic")
      file.flush
      upload = Rack::Test::UploadedFile.new(file.path, "application/pdf")
      PdfConverter.stub(:convert, ->(*) { raise PdfConverter::Invalid, "unsupported PDF" }) do
        post api_pdf_imports_url, params: { file: upload }
      end
      assert_response :unprocessable_entity
      assert_equal "unsupported PDF", response.parsed_body["error"]
      file.rewind
      PdfConverter.stub(:convert, ->(*) { raise PdfConverter::Unavailable, "recognizer down" }) do
        post api_pdf_imports_url, params: { file: upload }
      end
      assert_response :service_unavailable
      assert_equal "recognizer down", response.parsed_body["error"]
    end
  end
end
