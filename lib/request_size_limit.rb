require "json"

class RequestSizeLimit
  MAX_BYTES = 12_000_000
  ERROR = "Request body is too large (12 MB maximum)."

  def initialize(app)
    @app = app
  end

  def call(env)
    return @app.call(env) unless env["CONTENT_LENGTH"].to_i > MAX_BYTES

    [ 413, { "Content-Type" => "application/json", "Cache-Control" => "no-store" }, [ JSON.generate(error: ERROR) ] ]
  end
end
