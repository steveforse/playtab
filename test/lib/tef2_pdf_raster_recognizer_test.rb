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

  test "detects a stacked two-four time signature from OCR labels" do
    recognizer = Tef2::PdfRasterRecognizer.new
    system = {
      bars: [ 100, 300 ],
      texts: [ { x: 104, y: 150, text: "2" }, { x: 104, y: 140, text: "4" } ]
    }

    assert_equal({ numerator: 2, denominator: 4 }, recognizer.send(:detect_time_signature, [ system ]))
  end

  test "keeps raster annotation guesses out of the MusicXML preview" do
    recognizer = Tef2::PdfRasterRecognizer.new
    score = {
      tuning_label: "",
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
    assert_empty result[:techniques]
    assert_empty result[:fingerings]
    assert_empty result[:endings]
    assert_empty result[:repeats]
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
    assert_operator score[:measures], :>, 0
    assert_operator score[:notes].length, :>, 0
    assert score[:warnings].any? { |warning| warning.start_with?("Raster PDF") }
  end
end
