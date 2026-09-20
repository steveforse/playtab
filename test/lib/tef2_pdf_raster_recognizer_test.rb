# frozen_string_literal: true

require "test_helper"
require "tef2/pdf_raster_recognizer"

class Tef2PdfRasterRecognizerTest < ActiveSupport::TestCase
  test "groups five evenly spaced raster staff lines" do
    recognizer = Tef2::PdfRasterRecognizer.new
    lines = [ 100, 124, 149, 173, 198, 300, 324, 348, 373, 397 ].map { |y| { y: y, x0: 0, x1: 800 } }

    groups = recognizer.send(:staff_groups, lines)

    assert_equal 2, groups.length
    assert_equal [ 100, 124, 149, 173, 198 ], groups.first.map { |line| line[:y] }
  end

  test "rejects uneven line spacing instead of inventing a staff" do
    recognizer = Tef2::PdfRasterRecognizer.new
    lines = [ 100, 124, 150, 190, 198 ].map { |y| { y: y, x0: 0, x1: 800 } }

    assert_empty recognizer.send(:staff_groups, lines)
  end

  test "clusters nearby raster bar pixels into one boundary" do
    recognizer = Tef2::PdfRasterRecognizer.new

    assert_equal [ [ 10, 11, 12 ], [ 40, 45 ], [ 100 ] ], recognizer.send(:cluster_pixels, [ 12, 10, 11, 45, 40, 100 ], 5)
  end

  test "rejects full-height note stems as raster barlines" do
    recognizer = Tef2::PdfRasterRecognizer.new
    width = 40
    height = 90
    pixels = "\xff".b * (width * height)
    line_pixels = [ 20, 28, 36, 44, 52 ]

    line_pixels.each do |y|
      width.times { |x| pixels.setbyte(y * width + x, 0) }
    end
    (20..52).each { |y| pixels.setbyte(y * width + 10, 0) }
    (14..68).each { |y| pixels.setbyte(y * width + 20, 0) }

    assert_equal false, recognizer.send(:note_stem_extension?, pixels, width, 10, 20, 52)
    assert_equal true, recognizer.send(:note_stem_extension?, pixels, width, 20, 20, 52)
  end

  test "merges digit fragments split by a staff line" do
    recognizer = Tef2::PdfRasterRecognizer.new
    fragments = [
      { x: 10, y: 4, width: 14, height: 10, area: 40 },
      { x: 11, y: 17, width: 13, height: 9, area: 36 },
      { x: 50, y: 4, width: 12, height: 10, area: 40 }
    ]

    merged = recognizer.send(:merge_staff_fragments, fragments)

    assert_equal [ { x: 10, y: 4, width: 14, height: 22, area: 76 }, fragments.last ], merged.sort_by { |item| item[:x] }
  end

  test "maps raster tab rows from the top staff line to the first string" do
    recognizer = Tef2::PdfRasterRecognizer.new
    component = { x: 10, y: 0, width: 16, height: 24, area: 100 }

    assert_equal "0", recognizer.send(:raster_component_value, nil, component, 100, [ 100, 124, 148, 172, 196 ])
  end

  test "deduplicates overlapping raster glyph notes on one string" do
    recognizer = Tef2::PdfRasterRecognizer.new
    notes = [
      { x: 100, string: 0, fret: 0 },
      { x: 103, string: 0, fret: 9 },
      { x: 103, string: 1, fret: 2 }
    ]

    assert_equal [ notes[0], notes[2] ], recognizer.send(:deduplicate_raster_notes, notes)
  end

  test "detects a stacked two-four time signature from OCR labels" do
    recognizer = Tef2::PdfRasterRecognizer.new
    system = {
      bars: [ 100, 300 ],
      texts: [ { x: 104, y: 150, text: "2" }, { x: 104, y: 140, text: "4" } ]
    }

    assert_equal({ numerator: 2, denominator: 4 }, recognizer.send(:detect_time_signature, [ system ]))
  end

  test "keeps unsupported raster annotations out while preserving structural metadata" do
    recognizer = Tef2::PdfRasterRecognizer.new
    score = {
      tuning_label: "",
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0, dead: false, ghost: false },
        { measure: 0, position: 0, string: 0, fret: 0, dead: false, ghost: false }
      ],
      sections: [ { text: "Verse" } ],
      chords: [ { name: "G" } ],
      chord_diagrams: [ { name: "G" } ],
      lyrics: "Verse",
      techniques: [ { type: "hammer-on" } ],
      fingerings: [ { value: "T" } ],
      endings: [ { number: "1" } ],
      repeats: [ { start: 0 } ],
      ties: [ { type: "start" } ],
      tempo: 120,
      warnings: [ "PDF legato mark(s) were not attached because the nearby frets did not confirm its direction." ]
    }

    result = recognizer.send(:apply_raster_metadata_fallbacks, score, [ { texts: [ { text: "(G tuning)" } ] } ])

    assert_equal "gDGBD", result[:tuning_label]
    assert_empty result[:sections]
    assert_empty result[:chords]
    assert_empty result[:chord_diagrams]
    assert_nil result[:lyrics]
    assert_equal 1, result[:notes].length
    assert_empty result[:techniques]
    assert_equal [ { value: "T" } ], result[:fingerings]
    assert_equal [ { number: "1" } ], result[:endings]
    assert_equal [ { start: 0 } ], result[:repeats]
    assert_empty result[:ties]
    assert_nil result[:tempo]
    assert result[:warnings].none? { |warning| warning.include?("legato") }
    assert result[:warnings].any? { |warning| warning.include?("not imported yet") }
  end

  test "recognizes the private scanned Foggy Mountain PDF when supplied" do
    path = ENV["PLAYTAB_FOGGY_MOUNTAIN_BREAKDOWN_PDF"]
    skip "Set PLAYTAB_FOGGY_MOUNTAIN_BREAKDOWN_PDF for the private raster-PDF regression." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))

    assert_equal "FOGGY MOUNTAIN BREAKDOWN", score[:title]
    assert_equal "gDGBD", score[:tuning_label]
    assert_equal({ numerator: 2, denominator: 4 }, score[:time_signature])
    assert_equal 22, score[:measures]
    assert_operator score[:notes].length, :>, 0
    notes_for = ->(measure) {
      score[:notes].select { |note| note[:measure] == measure }.map { |note| [ note[:string], note[:fret] ] }
    }
    assert_equal [ [ 0, 0 ], [ 2, 0 ] ], notes_for.call(0)
    assert_equal [ 0 ], score[:notes].select { |note| note[:measure] == 0 }.map { |note| note[:position] }.uniq
    assert_equal [
      [ 1, 2 ], [ 1, 3 ], [ 1, 2 ], [ 0, 0 ], [ 1, 3 ], [ 4, 0 ], [ 1, 0 ], [ 0, 0 ], [ 4, 0 ]
    ], notes_for.call(1)
    assert_equal [
      [ 1, 2 ], [ 1, 3 ], [ 1, 2 ], [ 1, 3 ], [ 4, 0 ], [ 1, 0 ], [ 0, 0 ], [ 4, 0 ]
    ], notes_for.call(2)
    assert_equal [
      [ 1, 2 ], [ 1, 3 ], [ 1, 2 ], [ 1, 3 ], [ 0, 0 ], [ 4, 0 ], [ 2, 3 ],
      [ 0, 0 ], [ 2, 2 ], [ 4, 0 ]
    ], notes_for.call(3)
    assert_includes score[:techniques].map { |technique| technique.slice(:measure, :position, :string, :type) },
      { measure: 1, position: 0, string: 1, type: "hammer-on" }
    assert_includes score[:techniques].map { |technique| technique.slice(:measure, :position, :string, :type) },
      { measure: 3, position: 320, string: 2, type: "pull-off" }
    fingerings_for = ->(measure) {
      score[:fingerings].select { |fingering| fingering[:measure] == measure }
        .sort_by { |fingering| [ fingering[:position], fingering[:string] ] }
        .map { |fingering| fingering[:value] }
    }
    assert_equal %w[M I], fingerings_for.call(0)
    assert_equal %w[I T M T I M T], fingerings_for.call(1)
    assert_equal %w[I T M T I M T], fingerings_for.call(2)
    assert_equal %w[I T M T I M T], fingerings_for.call(3)
    assert_includes score[:repeats], { measure: 16, location: "left", direction: "forward", confidence: "high" }
    assert_includes score[:repeats], { measure: 16, location: "right", direction: "backward", confidence: "high" }
    assert_equal [ "1", "2" ], score[:endings].sort_by { |ending| ending[:measure] }.map { |ending| ending[:number] }
    assert_includes score[:warnings], "Only the first raster PDF page was imported; additional pages were omitted."
    assert score[:warnings].any? { |warning| warning.start_with?("Raster PDF") }
  end
end
