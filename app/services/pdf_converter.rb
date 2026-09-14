# frozen_string_literal: true

require "tef2/converter_client"

class PdfConverter
  class Invalid < StandardError; end
  class Unavailable < StandardError; end

  MAX_PDF_SIZE = 10_000_000
  MAX_MUSICXML_SIZE = 2_000_000

  def self.convert(bytes)
    raise Invalid, "PDF upload is empty or too large." unless bytes.is_a?(String) && bytes.bytesize.between?(1, MAX_PDF_SIZE)

    client = Tef2::ConverterClient.new
    result = client.convert_pdf(bytes)
    musicxml = result.fetch("musicxml")
    warnings = result.fetch("warnings", [])
    raise Unavailable, "PDF conversion produced empty MusicXML" if musicxml.blank?
    raise Unavailable, "Converted MusicXML exceeds size limit (#{MAX_MUSICXML_SIZE} bytes)" if musicxml.bytesize > MAX_MUSICXML_SIZE
    raise Unavailable, "Invalid PDF conversion warnings" unless warnings.is_a?(Array)

    { "musicxml" => musicxml, "warnings" => warnings }
  rescue Tef2::ConverterClient::Invalid => e
    raise Invalid, e.message
  rescue Tef2::ConverterClient::Unavailable => e
    raise Unavailable, e.message
  ensure
    client&.stop!
  end
end
