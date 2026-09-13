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
end
