# frozen_string_literal: true

require_relative "tef2/parser"
require_relative "tef2/timeline"
require_relative "tef2/musicxml_builder"
require_relative "tef2/full_parser"
require_relative "tef2/full_musicxml_builder"
require_relative "tef2/tabledit_v3_parser"
require_relative "tef2/exporter"

module Tef2
  class Error < StandardError; end
  class Invalid < Error; end

  # High-level conversion from TEF2 bytes to MusicXML
  # Uses the full native parser for TEF2 and TablEdit 3.00 files.
  def self.convert(bytes)
    result = try_full_parse(bytes)
    return result if result

    try_native_parse(bytes)
  rescue Parser::Invalid, FullParser::Invalid, TableditV3Parser::Invalid => e
    raise Invalid, e.message
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
    unsupported_effects = unsupported_effect_codes(parsed[:notes])
    unless unsupported_effects.empty?
      warnings << "Unsupported TEF effect codes are preserved as TEF technical metadata: #{unsupported_effects.join(', ')}."
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

  def self.unsupported_effect_codes(notes)
    notes.flat_map do |note|
      effect1 = note[:effect1].to_i
      effect2 = note[:effect2].to_i
      effect3 = note[:effect3]
      values = []
      values << "effect1=#{effect1}" unless (0..15).cover?(effect1)
      low = effect2 & 0x0F
      values << "effect2=#{low}" unless [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15 ].include?(low)
      values << "effect3=#{effect3.to_i}" if effect3 && !(0..11).cover?(effect3.to_i)
      values
    end.uniq.sort
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
end
