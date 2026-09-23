require "test_helper"
require_relative "../../lib/request_size_limit"

class RequestSizeLimitTest < ActiveSupport::TestCase
  class TestApp
    def call(_env)
      [ 200, { "X-Test" => "passed" }, [ "ok" ] ]
    end
  end

  setup { @middleware = RequestSizeLimit.new(TestApp.new) }

  test "passes requests under the limit" do
    response = @middleware.call("CONTENT_LENGTH" => (RequestSizeLimit::MAX_BYTES - 1).to_s)

    assert_equal 200, response.first
    assert_equal "passed", response.second["X-Test"]
  end

  test "passes requests without a content length" do
    assert_equal 200, @middleware.call({}).first
  end

  test "rejects requests over the limit before Rails parses them" do
    response = @middleware.call("CONTENT_LENGTH" => (RequestSizeLimit::MAX_BYTES + 1).to_s)

    assert_equal 413, response.first
    assert_equal "application/json", response.second["Content-Type"]
    assert_equal({ "error" => RequestSizeLimit::ERROR }, JSON.parse(response.third.first))
  end
end
