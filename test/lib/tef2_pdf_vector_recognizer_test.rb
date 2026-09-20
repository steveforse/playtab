require "test_helper"
require "tef2/pdf_vector_recognizer"

class Tef2PdfVectorRecognizerTest < ActiveSupport::TestCase
  Receiver = Struct.new(:segments, :curve_boxes, :subpaths)

  test "validates vector PDF input and page limits" do
    recognizer = Tef2::PdfVectorRecognizer.new

    assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize("not a PDF") }
    assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize("%PDF-1.7") }

    reader = Struct.new(:pages, :page_count).new([], 65)
    PDF::Reader.stub(:new, reader) do
      assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize("%PDF-1.7") }
    end

    PDF::Reader.stub(:new, ->(*) { raise "malformed" }) do
      error = assert_raises(Tef2::PdfRecognizer::Error) { recognizer.send(:read_pdf, "%PDF-1.7") }
      assert_equal "This PDF could not be read safely.", error.message
    end

    recognizer.stub(:read_pdf, ->(*) { raise "unexpected parser failure" }) do
      error = assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize("%PDF-1.7") }
      assert_equal "Vector PDF recognition failed: unexpected parser failure", error.message
    end
  end

  test "recovers five-line systems and collapses double barlines" do
    recognizer = Tef2::PdfVectorRecognizer.new
    segments = [
      [ 10, 100, 200, 100 ], [ 10, 110, 200, 110 ], [ 10, 120, 200, 120 ],
      [ 10, 130, 200, 130 ], [ 10, 140, 200, 140 ],
      [ 10, 100, 10, 140 ], [ 100, 100, 100, 140 ], [ 102, 100, 102, 140 ], [ 200, 100, 200, 140 ]
    ]
    receiver = Receiver.new(segments, [], [])
    system = recognizer.send(:recover_staffs, receiver).first

    assert_equal [ 140.0, 130.0, 120.0, 110.0, 100.0 ], system[:lines]
    edges, boundaries = recognizer.send(:barlines, receiver, system)
    assert_equal [ 10.0, 102.0, 200.0 ], edges
    assert_equal [ 10.0, 102.0, 200.0 ], boundaries
  end

  test "closes polygon rasterization while retaining stroke glyphs" do
    recognizer = Tef2::PdfVectorRecognizer.new
    square = [ [ 0.0, 0.0 ], [ 4.0, 0.0 ], [ 4.0, 4.0 ], [ 0.0, 4.0 ] ]
    grid = recognizer.send(:rasterize, [ square ], scale: 2)

    assert grid.flatten.any?(&:positive?)
    assert_equal 4, recognizer.send(:polygon_edges, square).length
    assert_equal [], recognizer.send(:holes, grid)
    inner = [ [ 1.0, 1.0 ], [ 3.0, 1.0 ], [ 3.0, 3.0 ], [ 1.0, 3.0 ] ]
    holed_grid = recognizer.send(:rasterize, [ square, inner ], scale: 2)
    assert_equal 1, recognizer.send(:holes, holed_grid).length
    png = recognizer.send(:to_png, grid.length, grid.first.length, grid)
    assert png.start_with?("\x89PNG".b)
  end

  test "recognizes the bounded TablEdit outline profiles" do
    recognizer = Tef2::PdfVectorRecognizer.new

    assert_equal 0, recognizer.send(:tabl_edit_outline_digit, profile(145, 6, 10))
    assert_equal 2, recognizer.send(:tabl_edit_outline_digit, profile(347, 5, 10))
    assert_equal 4, recognizer.send(:tabl_edit_outline_digit, profile(296, 7, 10))
    assert_equal 3, recognizer.send(:tabl_edit_outline_digit, profile(373, 5.5, 10))
    assert_equal 5, recognizer.send(:tabl_edit_outline_digit, profile(373, 6, 10))
    assert_nil recognizer.send(:tabl_edit_outline_digit, profile(20, 12, 5))

    assert_equal "C", recognizer.send(:tabl_edit_outline_letter, profile(305, 6, 10))
    assert_equal "m", recognizer.send(:tabl_edit_outline_letter, profile(324, 9, 7))
    assert_equal "H", recognizer.send(:tabl_edit_outline_technique, profile(354, 5, 8))
    assert_equal "P", recognizer.send(:tabl_edit_outline_technique, profile(193, 4, 7))
    assert_nil recognizer.send(:tabl_edit_outline_technique, profile(20, 4, 7))
    assert_equal "m", recognizer.send(:tabl_edit_outline_right_hand_fingering, profile(554, 7, 5))
    assert_equal "t", recognizer.send(:tabl_edit_outline_right_hand_fingering, profile(376, 3, 6))
    assert_nil recognizer.send(:tabl_edit_outline_right_hand_fingering, profile(20, 12, 5))
  end

  test "handles generic contour digit branches and OCR failures" do
    recognizer = Tef2::PdfVectorRecognizer.new
    outer = [ [ 0.0, 0.0 ], [ 12.0, 0.0 ], [ 12.0, 12.0 ], [ 0.0, 12.0 ] ]
    hole = [ [ 2.0, 2.0 ], [ 6.0, 2.0 ], [ 6.0, 10.0 ], [ 2.0, 10.0 ] ]
    two_holes = [ [ 8.0, 2.0 ], [ 10.0, 2.0 ], [ 10.0, 4.0 ], [ 8.0, 4.0 ] ]

    assert_equal 8, recognizer.send(:digit_from_geometry, [ outer, hole, two_holes ])
    assert_includes [ 0, 4, 6, 9 ], recognizer.send(:digit_from_geometry, [ outer, hole ])

    glyph = [ [ [ 0.0, 0.0 ], [ 3.0, 0.0 ], [ 3.0, 3.0 ], [ 0.0, 3.0 ] ] ]
    recognizer.stub(:holes, [ { area: 1, y: 14 } ]) do
      assert_equal 4, recognizer.send(:digit_from_geometry, glyph)
    end
    recognizer.stub(:holes, [ { area: 100, y: 14 } ]) do
      assert_equal 6, recognizer.send(:digit_from_geometry, glyph)
    end

    recognizer.instance_variable_set(:@tesseract_available, true)
    Open3.stub(:capture2, ->(*) { raise "tesseract failed" }) do
      assert_nil recognizer.send(:ocr_shape, [ outer ], "0123456789")
    end
  end

  test "groups chord letters and attaches vector techniques" do
    recognizer = Tef2::PdfVectorRecognizer.new
    system = { top: 100, bottom: 140, x0: 10, x1: 200, lines: [ 100, 110, 120, 130, 140 ] }
    receiver = Receiver.new([], [], [])
    d = profile(388, 6, 10)
    m = profile(324, 9, 7)
    h = profile(354, 5, 8)
    p = profile(193, 4, 7)

    recognizer.stub(:cluster_glyphs, [ [ d, m ], [ { x: 70, y: 130, shape: 0 }, { x: 79, y: 130, shape: 1 } ] ]) do
      chords = []
      recognizer.send(:chords_for_system, receiver, system, ->(x) { x == 70 ? 0 : nil }, chords)
      assert_equal [ { measure: 0, position: 0, name: "Dm" } ], chords
    end

    recognizer.stub(:cluster_glyphs, [ [ h, p ], [ { x: 70, y: 114, shape: 0 }, { x: 80, y: 114, shape: 1 } ] ]) do
      techniques = []
      notes = [ { measure: 0, position: 0, string: 0, x: 70 }, { measure: 0, position: 64, string: 0, x: 80 } ]
      recognizer.send(:techniques_for_system, receiver, system, ->(x) { x == 70 || x == 80 ? 0 : nil }, notes, techniques)
      assert_equal [ "hammer-on", "pull-off" ], techniques.map { |item| item[:type] }
    end
  end

  test "attaches vector right-hand fingering marks to nearby notes" do
    recognizer = Tef2::PdfVectorRecognizer.new
    system = { top: 100, bottom: 140, x0: 10, x1: 200, lines: [ 100, 110, 120, 130, 140 ] }
    receiver = Receiver.new([], [], [])
    m = profile(554, 7, 5)
    t = profile(376, 3, 6)
    notes = [
      { measure: 0, position: 0, string: 1, x: 70 },
      { measure: 0, position: 256, string: 2, x: 80 }
    ]
    fingerings = []

    recognizer.stub(:cluster_glyphs, [ [ m, t ], [ { x: 70, y: 100, shape: 0 }, { x: 80, y: 100, shape: 1 } ] ]) do
      recognizer.send(:fingerings_for_system, receiver, system, ->(_x) { 0 }, notes, fingerings)
    end

    assert_equal [ "m", "t" ], fingerings.map { |fingering| fingering[:value] }
    assert_equal [ [ 0, 0, 1 ], [ 0, 256, 2 ] ], fingerings.map { |fingering| fingering.values_at(:measure, :position, :string) }
  end

  test "attaches vector up and down arrowheads to nearby notes" do
    recognizer = Tef2::PdfVectorRecognizer.new
    system = { top: 100, bottom: 140, x0: 10, x1: 200, lines: [ 100, 110, 120, 130, 140 ] }
    triangle = lambda do |x, direction|
      points = direction == "up" ? [ [ x - 2, 96 ], [ x, 104 ], [ x + 2, 96 ], [ x - 2, 96 ] ] : [ [ x - 2, 104 ], [ x, 96 ], [ x + 2, 104 ], [ x - 2, 104 ] ]
      { start: points.first, segments: points.drop(1).map { |px, py| { kind: :line, x: px, y: py } } }
    end
    receiver = Receiver.new([], [], [ triangle.call(70, "up"), triangle.call(80, "down") ])
    notes = [ { measure: 0, position: 0, string: 1, x: 70 }, { measure: 0, position: 256, string: 2, x: 80 } ]
    strums = []

    recognizer.send(:strums_for_system, receiver, system, ->(_x) { 0 }, notes, strums)

    assert_equal [ "up", "down" ], strums.map { |strum| strum[:direction] }
    assert_equal [ [ 0, 0, 1 ], [ 0, 256, 2 ] ], strums.map { |strum| strum.values_at(:measure, :position, :string) }
  end

  test "attaches a standalone slide-in stroke to the following fret" do
    recognizer = Tef2::PdfVectorRecognizer.new
    system = { top: 100, bottom: 140, x0: 10, x1: 200, lines: [ 100, 110, 120, 130, 140 ] }
    slash = {
      start: [ 70, 90 ],
      segments: [ { kind: :line, x: 78, y: 97 } ]
    }
    receiver = Receiver.new([], [], [ slash ])
    notes = [ { measure: 0, position: 0, string: 1, x: 80, fret: 2 } ]
    techniques = []

    recognizer.send(:slide_ins_for_system, receiver, system, ->(_x) { 0 }, notes, techniques)

    assert_equal [ { measure: 0, position: 0, string: 1, type: "slide-in", label: "/" } ], techniques
  end

  test "normalizes the recognized Whisky header metadata" do
    recognizer = Tef2::PdfVectorRecognizer.new
    lines = [
      { top: 120, text: "WHISKY Berore BREAKFAST" },
      { top: 240, text: "(id. PLaYBETTERBANIO.COM" },
      { top: 297, text: "ARRANGED BY RYAN SPEARMAN" }
    ]

    assert_equal(
      { title: "Whisky Before Breakfast", subtitle: "www.PlayBetterBanjo.com", arranger: "Arranged by Ryan Spearman" },
      recognizer.send(:metadata_from_header_lines, lines)
    )
  end

  test "groups simultaneous notes and keeps rhythm inside a measure" do
    recognizer = Tef2::PdfVectorRecognizer.new
    notes = [
      { x: 10.0, string: 1 }, { x: 10.4, string: 2 },
      { x: 20.0, string: 1 }, { x: 30.0, string: 1 },
      { x: 40.0, string: 1 }, { x: 50.0, string: 1 }, { x: 60.0, string: 1 }
    ]

    recognizer.send(:assign_rhythm, notes)

    assert_equal 6, recognizer.send(:note_events, notes).length
    assert_equal [ 0, 0 ], notes.first(2).map { |note| note[:position] }
    assert notes.all? { |note| note[:position].between?(0, 960) }
  end

  test "attaches ties and detects a capo marker" do
    recognizer = Tef2::PdfVectorRecognizer.new
    system = { top: 100, bottom: 140, x0: 10, x1: 200, lines: [ 100, 110, 120, 130, 140 ] }
    receiver = Receiver.new([], [ { x: 50, y: 115, width: 10, height: 5 } ], [])
    notes = [
      { x: 48, measure: 0, position: 0, string: 1 },
      { x: 58, measure: 0, position: 128, string: 1 }
    ]
    ties = []
    recognizer.send(:ties_for_system, receiver, system, notes, ties)
    assert_equal [ "start", "stop" ], ties.map { |tie| tie[:type] }

    digit = profile(347, 5, 10)
    recognizer.stub(:cluster_glyphs, [ [ digit ], [ { x: 70, y: 115, shape: 0 } ] ]) do
      assert_equal 2, recognizer.send(:capo_for_system, receiver, system, [ 10, 100 ])
    end
  end

  test "does not attach a tie to two notes at the same onset" do
    recognizer = Tef2::PdfVectorRecognizer.new
    system = { top: 100, bottom: 140, x0: 10, x1: 200, lines: [ 100, 110, 120, 130, 140 ] }
    receiver = Receiver.new([], [ { x: 50, y: 115, width: 10, height: 5 } ], [])
    notes = [
      { x: 48, measure: 0, position: 0, string: 1 },
      { x: 48, measure: 0, position: 0, string: 1 }
    ]
    ties = []

    recognizer.send(:ties_for_system, receiver, system, notes, ties)

    assert_empty ties
  end

  test "recovers the five vector tuning labels in low-to-high order" do
    recognizer = Tef2::PdfVectorRecognizer.new
    receiver = Receiver.new([], [], [])
    system = { top: 100, bottom: 60, x0: 80, x1: 200, lines: [ 100, 90, 80, 70, 60 ] }
    letters = [ "D", "C", "G", "C", "G" ].map.with_index do |letter, index|
      shape = profile({ "D" => 388, "C" => 305, "G" => 395 }.fetch(letter), 6, 10)
      [ shape, { x: 60, y: 100 - index * 10, shape: index } ]
    end

    recognizer.stub(:cluster_glyphs, [ letters.map(&:first), letters.map(&:last) ]) do
      assert_equal "gCGCD", recognizer.send(:tuning_label_for_system, receiver, system)
    end
  end

  test "rejects a vector system that contains no notes" do
    recognizer = Tef2::PdfVectorRecognizer.new
    receiver = Receiver.new([], [], [])
    system = { top: 100, bottom: 140, x0: 10, x1: 100, lines: [ 100, 110, 120, 130, 140 ] }
    recognizer.stub(:recover_staffs, [ system ]) do
      recognizer.stub(:barlines, [ [], [ 10, 100 ] ]) do
        recognizer.stub(:cluster_glyphs, [ [], [] ]) do
          assert_raises(Tef2::PdfRecognizer::Error) do
            recognizer.send(:build_score, [ receiver ], [ system ], "Empty.pdf")
          end
        end
      end
    end
  end

  private

  def profile(count, width, height)
    Array.new(count) do |index|
      [ (index % 11) * width.to_f / 10, (index % 13) * height.to_f / 12 ]
    end.then { |points| [ points ] }
  end
end
