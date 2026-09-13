require "tef2"

class TefConverter
  class Invalid < StandardError; end
  class Unavailable < StandardError; end

  MAX_MUSICXML_SIZE = 2_000_000

  def self.convert(bytes)
    result = Tef2.convert(bytes)
    musicxml = result.fetch(:musicxml)
    warnings = result.fetch(:warnings, [])

    raise Unavailable, "Conversion produced empty MusicXML" if musicxml.blank?
    raise Unavailable, "Converted MusicXML exceeds size limit (#{MAX_MUSICXML_SIZE} bytes)" if musicxml.bytesize > MAX_MUSICXML_SIZE
    raise Unavailable, "Invalid warnings format" unless warnings.is_a?(Array)

    { "musicxml" => musicxml, "warnings" => warnings }
  rescue Tef2::Invalid => e
    raise Invalid, e.message
  rescue Tef2::Unavailable => e
    raise Unavailable, e.message
  rescue Tef2::Error => e
    raise Unavailable, "TEF conversion failed: #{e.message}"
  end
end
