require "test_helper"

class TefImportsTest < ActionDispatch::IntegrationTest
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

  test "rejects the wrong extension and reports an unavailable converter" do
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
end
