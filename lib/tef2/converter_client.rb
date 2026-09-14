# frozen_string_literal: true

require "net/http"
require "json"
require "tempfile"
require "open3"

module Tef2
  # Client for the Python TEF2 converter HTTP service
  # Runs as a child process managed by Rails (no Docker needed)
  class ConverterClient
    class Unavailable < StandardError; end
    class Invalid < StandardError; end

    DEFAULT_PORT = 8080
    STARTUP_TIMEOUT = 10
    REQUEST_TIMEOUT = 20

    def initialize(port: DEFAULT_PORT, converter_script: nil, base_url: ENV["TEF_CONVERTER_URL"])
      @port = port
      @converter_script = converter_script || Rails.root.join("converter/server.py").to_s
      @pid = nil
      @local_process = base_url.to_s.empty?
      @uri = URI(base_url.to_s.empty? ? "http://127.0.0.1:#{@port}" : base_url)
    end

    # Convert TEF2 bytes to MusicXML via the Python service
    # Starts the service on demand if not running
    def convert(bytes)
      request_conversion(bytes, "/convert")
    end

    # Convert a vector PDF score to MusicXML via the Python service.
    def convert_pdf(bytes)
      request_conversion(bytes, "/pdf")
    end

    private

    def request_conversion(bytes, endpoint)
      ensure_running!

      http = Net::HTTP.new(@uri.host, @uri.port)
      http.open_timeout = 2
      http.read_timeout = REQUEST_TIMEOUT
      http.write_timeout = 5

      request = Net::HTTP::Post.new(endpoint)
      request["Content-Type"] = "application/octet-stream"
      request.body = bytes

      response = http.request(request)
      result = JSON.parse(response.body)

      unless response.is_a?(Net::HTTPSuccess)
        raise Invalid, result.fetch("error", "TEF conversion failed")
      end

      unless result["musicxml"].is_a?(String) &&
             result["musicxml"].bytesize <= 2_000_000 &&
             result["warnings"].is_a?(Array)
        raise Unavailable, "Converter returned invalid response"
      end

      { "musicxml" => result["musicxml"], "warnings" => result["warnings"] }
    rescue JSON::ParserError, IOError, SystemCallError, SocketError, Timeout::Error, Net::HTTPBadResponse
      stop!
      raise Unavailable, "TEF converter is unavailable or timed out. Please try again."
    end

    # Start the Python converter server as a child process
    public

    def ensure_running!
      return unless @local_process
      return if running?

      @pid = spawn_python_server
      wait_for_ready
    rescue => e
      stop!
      raise Unavailable, "Failed to start TEF converter: #{e.message}"
    end

    # Stop the converter child process
    def stop!
      return unless @local_process && @pid
      Process.kill("TERM", @pid)
      Process.wait(@pid)
    rescue Errno::ESRCH, Errno::ECHILD
      # Already dead
    ensure
      @pid = nil
    end

    def running?
      @pid && Process.kill(0, @pid)
    rescue Errno::ESRCH
      false
    end

    private

    def spawn_python_server
      # Run Python server in background, suppress output
      Process.spawn(
        "python3", @converter_script,
        in: "/dev/null",
        out: "/dev/null",
        err: "/dev/null",
        pgroup: true
      )
    end

    def wait_for_ready
      deadline = Time.now + STARTUP_TIMEOUT
      loop do
        break if health_check
        raise Unavailable, "Converter failed to start" if Time.now > deadline
        sleep 0.1
      end
    end

    def health_check
      http = Net::HTTP.new(@uri.host, @uri.port)
      http.open_timeout = 1
      http.read_timeout = 1
      response = http.get("/health")
      response.is_a?(Net::HTTPSuccess)
    rescue
      false
    end
  end
end
