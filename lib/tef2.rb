# frozen_string_literal: true

require_relative "tef2/parser"
require_relative "tef2/timeline"
require_relative "tef2/musicxml_builder"
require_relative "tef2/full_parser"
require_relative "tef2/repeat_map"
require_relative "tef2/reading_list"
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

    repeat_records, repeat_warnings, decoded_repeats = RepeatMap.decode(parsed[:repeats], parsed[:measures])
    parsed[:endings] = (parsed[:endings] || []) + repeat_records
    guides, reading_warnings = ReadingList.decode(parsed[:reading_list] || [], parsed[:measures])
    parsed[:reading_guides] = guides
    repeat_warnings += reading_warnings

    musicxml = FullMusicxmlBuilder.build(parsed)
    warnings = [
      tabledit_v3 ? "Native Ruby TablEdit 3.00 conversion" : "Native Ruby TEF2 conversion (full)"
    ] + repeat_warnings
    unknown_annotations = parsed[:annotations].values.uniq - [ 2, 3, 4, 5, 6, 18 ]
    suppressed = unknown_annotations & Tef2::FullMusicxmlBuilder::SUPPRESSED_ANNOTATIONS
    unless suppressed.empty?
      warnings << "TEF annotation codes with no visible TefView rendering are omitted: #{suppressed.sort.join(', ')}."
    end
    unless (unknown_annotations - suppressed).empty?
      warnings << "TEF fingering codes without a known finger mapping are shown as TEF code labels."
    end
    unsupported_effects = unsupported_effect_codes(parsed[:notes])
    unless unsupported_effects.empty?
      warnings << "Unsupported TEF effect codes are preserved as TEF technical metadata: #{unsupported_effects.join(', ')}."
    end
    capo = (parsed[:track_data] || []).map { |track| track[:capo].to_i }.max.to_i
    if capo.positive?
      warnings << "Capo #{capo}: 5th-string fret numbers are displayed relative to the capo, matching the printed tab; other strings are unchanged."
    end
    if parsed[:repeats].count { |repeat| repeat[:start].nonzero? || repeat[:length].nonzero? } > decoded_repeats
      warnings << "Some TEF2 repeat-map entries were not decoded; the imported score follows the source's written measures once."
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
