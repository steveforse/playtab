# frozen_string_literal: true

require_relative "tef2/parser"
require_relative "tef2/timeline"
require_relative "tef2/musicxml_builder"
require_relative "tef2/full_parser"
require_relative "tef2/full_musicxml_builder"
require_relative "tef2/tabledit_v3_parser"
require_relative "tef2/converter_client"

module Tef2
  class Error < StandardError; end
  class Invalid < Error; end
  class Unavailable < Error; end

  # High-level conversion from TEF2 bytes to MusicXML
  # Uses full native parser for complete TEF2 support
  # Falls back to Python/Java converter only if native parser fails
  def self.convert(bytes)
    # Try full native parser first (handles real TEF2 files)
    result = try_full_parse(bytes)
    return result if result

    # Fall back to Python/Java converter
    try_converter_service(bytes)
  rescue Parser::Invalid, FullParser::Invalid, TableditV3Parser::Invalid => e
    raise Invalid, e.message
  rescue Unavailable
    # Converter unavailable - try simple native parser
    try_native_parse(bytes)
  end

  # Full native TEF2 parser (complete implementation)
  def self.try_full_parse(bytes)
    tabledit_v3 = TableditV3Parser.tabledit_v3?(bytes)
    parser = tabledit_v3 ? TableditV3Parser : FullParser
    parsed = parser.parse(bytes)

    # Validate we got meaningful data
    raise FullParser::Invalid, "No notes parsed" if parsed[:notes].empty?

    musicxml = FullMusicxmlBuilder.build(parsed)
    warnings = [
      tabledit_v3 ? "Native Ruby TablEdit 3.00 conversion" : "Native Ruby TEF2 conversion (full)"
    ]
    if parsed[:annotations].values.any? { |code| ![ 2, 4, 6 ].include?(code) }
      warnings << "TEF fingering codes without a known finger mapping are shown as TEF code labels."
    end
    if parsed[:track_data].any? { |track| track[:capo].to_i.positive? }
      warnings << "Capo metadata is preserved in the source tuning; imported fret numbers are unchanged."
    end
    if parsed[:repeats].any? { |repeat| repeat[:start] != 0 || repeat[:length] != 0 }
      warnings << "Repeat maps are not expanded; the imported score follows the source's written measures once."
    end
    { musicxml: musicxml, warnings: warnings }
  rescue FullParser::Invalid, TableditV3Parser::Invalid => e
    raise e
  rescue => e
    # If full parser fails, fall back
    nil
  end

  # Simple native Ruby parser (fallback for basic subset)
  def self.try_native_parse(bytes)
    parsed = Parser.parse(bytes)
    timeline = Timeline.build(measures: parsed[:measures], components: parsed[:components])
    musicxml = MusicXmlBuilder.build(
      measures: parsed[:measures],
      timeline: timeline,
      annotations: parsed[:annotations]
    )
    { musicxml: musicxml, warnings: [ "Native Ruby TEF2 conversion (fallback - limited)" ] }
  rescue Parser::Invalid => e
    raise Invalid, e.message
  end

  # Try Python/Java converter service (child process)
  def self.try_converter_service(bytes)
    client = ConverterClient.new
    client.convert(bytes)
  rescue ConverterClient::Invalid => e
    raise Invalid, e.message
  rescue ConverterClient::Unavailable => e
    raise Unavailable, e.message
  ensure
    client&.stop!
  end
end
