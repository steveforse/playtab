# frozen_string_literal: true

require "tef2/pdf_musicxml_builder"
require "tef2/pdf_recognizer"

class PdfConverter
  class Invalid < StandardError; end
  class Unavailable < StandardError; end

  MAX_PDF_SIZE = 10_000_000
  MAX_MUSICXML_SIZE = 2_000_000

  def self.convert(bytes, filename: "")
    raise Invalid, "PDF upload is empty or too large." unless bytes.is_a?(String) && bytes.bytesize.between?(1, MAX_PDF_SIZE)

    score = Tef2::PdfRecognizer.recognize(bytes, filename: filename)
    musicxml = Tef2::PdfMusicxmlBuilder.build(score)
    warnings = score.fetch(:warnings, [])
    raise Unavailable, "PDF conversion produced empty MusicXML" if musicxml.blank?
    raise Unavailable, "Converted MusicXML exceeds size limit (#{MAX_MUSICXML_SIZE} bytes)" if musicxml.bytesize > MAX_MUSICXML_SIZE
    raise Unavailable, "Invalid PDF conversion warnings" unless warnings.is_a?(Array)

    { "musicxml" => musicxml, "warnings" => warnings }
  rescue Tef2::PdfRecognizer::Error => e
    raise Invalid, e.message
  rescue Invalid
    raise
  rescue StandardError => e
    raise Unavailable, "PDF conversion failed: #{e.message}"
  end
end
