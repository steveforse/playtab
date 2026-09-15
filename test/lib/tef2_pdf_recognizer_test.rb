require "test_helper"
require "tef2/pdf_recognizer"

class Tef2PdfRecognizerTest < ActiveSupport::TestCase
  FakeRun = Struct.new(:x, :y, :text, :width)
  FakePage = Struct.new(:runs_data, :segments, :width, :height, :flat_symbols_data, :curve_boxes_data) do
    def walk(receiver)
      receiver.configure(self)
    end
  end
  FakeReader = Struct.new(:pages) do
    def page_count
      pages.length
    end
  end
  FakeReceiver = Class.new do
    attr_reader :segments, :flat_symbols, :curve_boxes

    def configure(page)
      @runs = page.runs_data
      @segments = page.segments
      @flat_symbols = page.flat_symbols_data || []
      @curve_boxes = page.curve_boxes_data || []
    end

    def runs(**)
      @runs
    end
  end

  test "recognizes a bounded score, metadata, lyrics, and selectable tempo" do
    page = staff_page(
      title: "Demo",
      tuning: "gDGBD tuning",
      extra_texts: [
        [ 40, 570, "Verse" ],
        [ 40, 653, "C min" ],
        [ 100, 653, "A Maj" ],
        [ 40, 623, "H" ],
        [ 55, 623, "Sl" ],
        [ 40, 670, "1" ],
        [ 40, 700, "quarter note" ],
        [ 80, 700, "180" ]
      ],
      flat_symbols_data: [ { x: 105, y: 653, text: "!" } ]
    )
    lyrics = FakePage.new(
      [ FakeRun.new(40, 700, "VERSE", 30), FakeRun.new(40, 680, "One line", 40), FakeRun.new(40, 660, "Two lines", 40), FakeRun.new(40, 640, "Three lines", 40) ],
      [], 612, 792
    )
    with_reader([ page, lyrics ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf")

      assert_equal "Demo", result[:title]
      assert_equal "gDGBD", result[:tuning_label]
      assert_equal 2, result[:measures]
      assert_equal 180, result[:tempo]
      assert_equal "Verse", result[:sections].first[:text]
      assert_equal "C min", result[:chords].first[:name]
      assert_includes result[:chords].map { |chord| chord[:name] }, "Ab Maj"
      assert_equal "hammer-on", result[:techniques].first[:type]
      assert_equal "slide", result[:techniques].second[:type]
      assert_equal "1", result[:fingerings].first[:value]
      assert_equal "VERSE\nOne line\nTwo lines\nThree lines", result[:lyrics]
      assert result[:warnings].any?
    end
  end

  test "handles validation and reader failures safely" do
    recognizer = Tef2::PdfRecognizer.new
    [ nil, "", "not a pdf", "%PDF-" + ("x" * 10_000_001) ].each do |value|
      assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize(value) }
    end

    PDF::Reader.stub(:new, ->(*) { raise "malformed" }) do
      error = assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize("%PDF-1.7") }
      assert_equal "This PDF could not be read safely.", error.message
    end

    too_many_pages = FakeReader.new(Array.new(65) { empty_page })
    PDF::Reader.stub(:new, too_many_pages) do
      assert_raises(Tef2::PdfRecognizer::Error) { recognizer.recognize("%PDF-1.7") }
    end
  end

  test "rejects PDFs without systems or notes" do
    no_systems = FakeReader.new([ empty_page ])
    with_reader(no_systems.pages) do
      assert_raises(Tef2::PdfRecognizer::Error) { Tef2::PdfRecognizer.recognize("%PDF-1.7") }
    end

    no_notes = FakeReader.new([ staff_page(note_texts: []) ])
    with_reader(no_notes.pages) do
      assert_raises(Tef2::PdfRecognizer::Error) { Tef2::PdfRecognizer.recognize("%PDF-1.7") }
    end
  end

  test "covers timing, metadata normalization, and layout helpers" do
    recognizer = Tef2::PdfRecognizer.new
    assert_equal 0, recognizer.send(:position, 20, 20, 300)
    assert_equal 512, recognizer.send(:position, 160, 20, 300)
    assert_equal 896, recognizer.send(:position, 300, 20, 300)
    assert_equal 64, recognizer.send(:position_step, 20, 220, [ 45, 56.5, 68 ])
    assert_equal 32, recognizer.send(:position_step, 20, 220, [ 45, 53, 61, 69 ])
    assert_equal 128, recognizer.send(:position_step, 20, 220, [ 45, 100 ])
    assert_equal "C#", recognizer.send(:normalize_chord, "c #")
    assert_equal "C min", recognizer.send(:normalize_chord, "C m")
    assert_equal "G7", recognizer.send(:normalize_chord, "G7")
    assert_equal "", recognizer.send(:normalize_chord, "not a chord")
    assert_equal "hammer-on", recognizer.send(:technique_type, "Hammer-On")
    assert_equal "pull-off", recognizer.send(:technique_type, "p_o")
    assert_nil recognizer.send(:technique_type, "unknown")
    assert_equal "Demo", recognizer.send(:filename_without_extension, "C:\\tabs\\Demo.pdf")
    assert_equal [ "Demo", "gCGCD#" ], recognizer.send(:header, [ { x: 100, y: 750, text: "Demo" }, { x: 150, y: 740, text: "gCGCD# tuning" } ])
    assert_equal [ "Demo", "aDADE" ], recognizer.send(:header, [ { x: 100, y: 750, text: "Demo" }, { x: 150, y: 720, text: "key of D (aDADE tuning)" } ])
    assert_nil recognizer.send(:tempo, [ { texts: [ { x: 10, y: 100, text: "unrelated" } ] } ])

    assert_equal 2, recognizer.send(:beam_count_for_event, 50, [ [ 45, 80, 60, 80 ], [ 45, 82, 60, 82 ] ], 100)
    assert_nil recognizer.send(:beam_count_for_event, 50, [ [ 45, 98, 60, 98 ] ], 100)
    events = [ 2, 2, 1, 1, 1 ].each_with_index.map { |beam_count, index| { x: 10 + index * 10, beam_count: beam_count } }
    assert_equal [ 0, 64, 128, 256, 384 ], recognizer.send(:beam_rhythm_positions, 0, 100, events, 512)

    ending_system = { bars: [ 20, 100, 180 ], measure_start: 0, measure_layouts: [], events: [], bottom: 100 }
    endings = recognizer.send(:endings_for_system, ending_system, [
      { x: 101, y: 120, text: "1." }, { x: 105, y: 116, text: "D" }
    ])
    assert_equal [ { measure: 1, location: "left", number: "1", type: "start", confidence: "high" } ], endings

    system = { top: 600, bottom: 640, bars: [ 20, 300, 580 ], measure_start: 0, events: [ { x: 40, notes: [ { x: 40, string: 0, fret: 0 } ] } ] }
    assert recognizer.send(:section_label?, system, { y: 570 }, "A section")
    refute recognizer.send(:section_label?, system, { y: 600 }, "A section")
    refute recognizer.send(:section_label?, system, { y: 570 }, "a" * 33)
    refute recognizer.send(:section_label?, system, { y: 570 }, "H")
    refute recognizer.send(:section_label?, system, { y: 570 }, "C min")
    refute recognizer.send(:section_label?, system, { y: 570 }, "arranged by someone")
    assert recognizer.send(:technique_pair_valid?, { measure: 0, position: 0, string: 0, type: "hammer-on" }, [
      { measure: 0, position: 0, string: 0, fret: 0 }, { measure: 0, position: 128, string: 0, fret: 2 }
    ])
    refute recognizer.send(:technique_pair_valid?, { measure: 0, position: 0, string: 0, type: "pull-off" }, [
      { measure: 0, position: 0, string: 0, fret: 0 }, { measure: 0, position: 128, string: 0, fret: 2 }
    ])
    assert Tef2::PdfRecognizer::PageReceiver.new.send(:respond_to_missing?, :anything, false)
    chord_system = { bottom: 640, bars: [ 20, 300, 580 ], measure_start: 0, events: [] }
    assert_equal 1, recognizer.send(:chords_for_system, chord_system, [ { x: 40, y: 650, text: "C" }, { x: 50, y: 650, text: "min" } ]).length

    lyric_pages = [
      { systems: [ :tab ], texts: [ { x: 30, y: 500, text: "LYRICS & CHORDS" }, { x: 30, y: 490, text: "Cm" }, { x: 30, y: 480, text: "First line" } ] },
      { systems: [], texts: [ { x: 30, y: 700, text: "Second line" } ] }
    ]
    assert_equal "First line\nSecond line", recognizer.send(:lyrics, lyric_pages)

    layout = recognizer.send(:position_layout, 391.5, 477.8, [ 401.1, 411.9, 422.7, 433.5, 444.3 ], 512, 64)
    assert_equal [ 0, 64, 128, 192, 256 ], [ 401.1, 411.9, 422.7, 433.5, 444.3 ].map { |x| recognizer.send(:position, x, 391.5, 477.8, step: 64, measure_ticks: 512, layout: layout) }
    assert_equal 512, recognizer.send(:pdf_measure_ticks, numerator: 2, denominator: 4)

    curves = [ 110, 95, 110, 95, 110, 95, 110, 95, 110, 105, 110, 105, 110, 105, 110, 105,
      92, 95, 92, 95, 92, 95, 92, 95, 92, 105, 92, 105, 92, 105, 92, 105 ].each_slice(2).map do |x, y|
      { x: x, y: y, width: 2, height: 2 }
    end
    assert_equal [ { boundary: 101.0, direction: "forward" } ], recognizer.send(:repeat_barlines, [ 100, 102 ], curves, 90, 110, 20, 200)
    assert_equal [ { boundary: 101.0, direction: "backward" } ], recognizer.send(:repeat_barlines, [ 100, 102 ], curves.drop(8), 90, 110, 20, 200)
    assert_equal [
      { measure: 3, location: "left", direction: "forward", confidence: "high" },
      { measure: 6, location: "right", direction: "backward", confidence: "high" }
    ], recognizer.send(:repeat_metadata, [
      { measure_start: 3, bars: [ 100, 102 ], repeat_barlines: [ { boundary: 101, direction: "forward" } ] },
      { measure_start: 6, bars: [ 90, 101, 200 ], repeat_barlines: [ { boundary: 101, direction: "backward" } ] }
    ])

    assert_equal({ numerator: 3, denominator: 4 }, recognizer.send(:infer_time_signature_from_spacing, { numerator: 2, denominator: 4 }, [ { code: 33, y: 100 } ], [ { top: 90, bottom: 130, bars: [ 20, 100, 180 ], events: [ { x: 40 }, { x: 60 }, { x: 120 }, { x: 140 } ] } ]))
    assert_equal({ numerator: 2, denominator: 4 }, recognizer.send(:infer_time_signature_from_spacing, { numerator: 2, denominator: 4 }, [ { code: 33, y: 100 } ], [ { top: 90, bottom: 130, bars: [ 20, 100, 180 ], events: [ { x: 40 }, { x: 50 }, { x: 120 }, { x: 130 } ] } ]))
    assert_equal({ numerator: 2, denominator: 4 }, recognizer.send(:infer_time_signature_from_spacing, { numerator: 2, denominator: 4 }, [], []))
    assert_equal({ numerator: 2, denominator: 4 }, recognizer.send(:infer_time_signature_from_spacing, { numerator: 2, denominator: 4 }, [ { code: 33, y: 100 } ], []))
    assert_equal({ numerator: 3, denominator: 4 }, recognizer.send(:infer_time_signature_from_spacing, { numerator: 3, denominator: 4 }, [], []))

    single_layout = recognizer.send(:position_layout, 20, 100, [ 30 ], 768, 128)
    assert_equal 0, recognizer.send(:position, 30, 20, 100, step: 128, measure_ticks: 768, layout: single_layout)
    inferred_layout = recognizer.send(:position_layout, 20, 100, [ 70, 87 ], 768, 128)
    assert_equal [ 512, 640 ], [ 70, 87 ].map { |x| recognizer.send(:position, x, 20, 100, step: 128, measure_ticks: 768, layout: inferred_layout) }
    anchored_layout = recognizer.send(:position_layout, 20, 100, [ 30, 47 ], 768, 128)
    assert_equal [ 0, 128 ], [ 30, 47 ].map { |x| recognizer.send(:position, x, 20, 100, step: 128, measure_ticks: 768, layout: anchored_layout) }

    near_barline_layout = recognizer.send(:position_layout, 128.8196, 216.6118, [ 138.45, 155.72, 166.52, 178.43, 188.82, 200.34 ], 512, 64)
    assert_equal [ 0, 128, 192, 256, 320, 384 ], [ 138.45, 155.72, 166.52, 178.43, 188.82, 200.34 ].map { |x| recognizer.send(:position, x, 128.8196, 216.6118, step: 64, measure_ticks: 512, layout: near_barline_layout) }
  end

  test "handles line grouping, dead notes, and malformed pages" do
    recognizer = Tef2::PdfRecognizer.new
    horizontal = [ 600, 610, 620, 630, 640 ].map { |y| [ 20, y, 580, y ] }
    bars = [ [ 20, 600, 20, 640 ], [ 300, 600, 300, 640 ], [ 580, 600, 580, 640 ] ]
    texts = [ { x: 40, y: 636.4, text: "X" }, { x: 40, y: 636.4, text: "0" } ]
    result = recognizer.send(:systems, texts, horizontal + bars)
    assert_equal 2, result.first[:events].first[:notes].length
    assert result.first[:events].first[:notes].first[:dead]

    duplicate = horizontal + [ [ 20, 600, 500, 600 ] ] + bars
    assert_equal 1, recognizer.send(:systems, [], duplicate).length
    uneven = [ 600, 610, 630, 640, 650 ].map { |y| [ 20, y, 580, y ] }
    assert_empty recognizer.send(:systems, [], uneven)
    narrow = [ [ 20, 600, 150, 600 ], [ 60, 610, 190, 610 ], [ 20, 620, 150, 620 ], [ 60, 630, 190, 630 ], [ 20, 640, 150, 640 ] ]
    assert_empty recognizer.send(:systems, [], narrow)
    assert_empty recognizer.send(:systems, [], horizontal)

    ghost_texts = [
      { x: 40, y: 636.4, text: "(" },
      { x: 42.6, y: 636.4, text: "3" },
      { x: 47, y: 636.4, text: ")" }
    ]
    ghost_result = recognizer.send(:systems, ghost_texts, horizontal + bars)
    assert ghost_result.first[:events].first[:notes].first[:ghost]
    assert recognizer.send(:parenthesized_note?, { x: 40, y: 636.4, text: "(3)" }, [])

    bad_receiver = Object.new
    bad_receiver.define_singleton_method(:segments) { [] }
    bad_receiver.define_singleton_method(:runs) { |**| raise Tef2::PdfRecognizer::Error, "bad page" }
    bad_page = Object.new
    bad_page.define_singleton_method(:width) { 612 }
    bad_page.define_singleton_method(:height) { 792 }
    bad_page.define_singleton_method(:walk) { |_receiver| }
    Tef2::PdfRecognizer::PageReceiver.stub(:new, bad_receiver) do
      assert_raises(Tef2::PdfRecognizer::Error) { recognizer.send(:read_page, bad_page) }
    end
    bad_receiver.define_singleton_method(:runs) { |**| raise "bad page" }
    Tef2::PdfRecognizer::PageReceiver.stub(:new, bad_receiver) do
      assert_raises(Tef2::PdfRecognizer::Error) { recognizer.send(:read_page, bad_page) }
    end
  end

  test "page receiver records transformed line pairs" do
    receiver = Tef2::PdfRecognizer::PageReceiver.new
    state = Object.new
    state.define_singleton_method(:ctm_transform_point) { |x, y| Struct.new(:x, :y).new(x + 2, y + 3) }
    state.define_singleton_method(:trm_transform_point) do |point, y = nil|
      x = point.respond_to?(:x) ? point.x : point
      y = point.respond_to?(:y) ? point.y : y
      Struct.new(:x, :y).new(x + 2, y + 3)
    end
    state.define_singleton_method(:delegated_value) { :delegated }
    font = Object.new
    font.define_singleton_method(:unpack) { |_value| [ 0 ] }
    font.define_singleton_method(:to_utf8) { |_value| "" }
    font.define_singleton_method(:glyph_width_in_text_space) { |_value| 0 }
    state.define_singleton_method(:current_font) { font }
    state.define_singleton_method(:font_size) { 8 }
    state.define_singleton_method(:process_glyph_displacement) { |*| nil }
    receiver.instance_variable_set(:@state, state)
    receiver.instance_variable_set(:@characters, [])
    page = Object.new
    page.define_singleton_method(:rotate) { 0 }
    receiver.instance_variable_set(:@page, page)
    assert_equal :delegated, receiver.delegated_value
    receiver.show_text("!")
    receiver.show_text("#")
    assert_equal [ { x: 2, y: 3, text: "!" } ], receiver.flat_symbols
    assert_equal [ 33, 35 ], receiver.time_signature_symbols.map { |symbol| symbol[:code] }
    receiver.begin_new_subpath(10, 20)
    receiver.append_line(30, 40)
    receiver.append_line(50, 60)
    assert_equal [ [ 12, 23, 32, 43 ] ], receiver.segments
    receiver.begin_new_subpath(1, 1)
    receiver.stroke_path
    receiver.append_line(2, 2)
    assert_equal 1, receiver.segments.length
    receiver.append_curved_segment(10, 20, 30, 40, 50, 60)
    receiver.append_curved_segment_initial_point_replicated(10, 20, 30, 40, 50, 60)
    receiver.append_curved_segment_final_point_replicated(10, 20, 30, 40, 50, 60)
    assert_equal 3, receiver.curve_boxes.length
  end

  test "page receiver recognizes embedded time-signature glyph widths" do
    receiver = Tef2::PdfRecognizer::PageReceiver.new
    stream = Object.new
    stream.instance_variable_set(:@data, "compressed")
    descriptor = Object.new
    descriptor.instance_variable_set(:@font_program_stream, stream)
    font = Object.new
    font.define_singleton_method(:font_descriptor) { descriptor }

    cmap = Object.new
    cmap.define_singleton_method(:[]) { |_code| 7 }
    ttf = Object.new
    ttf.define_singleton_method(:cmap) { Struct.new(:tables).new([ cmap ]) }
    ttf.define_singleton_method(:find_glyph) { |_index| Struct.new(:x_min, :x_max).new(0, 400) }
    receiver.instance_variable_set(:@time_signature_symbols, [
      { x: 10, y: 10, code: 33, font: font },
      { x: 10, y: 20, code: 34, font: font }
    ])

    Zlib::Inflate.stub(:inflate, "ttf") do
      TTFunk::File.stub(:open, ->(*) { ttf }) do
        assert_equal({ numerator: 2, denominator: 4 }, receiver.time_signature)
      end
    end

    receiver.instance_variable_set(:@time_signature_symbols, [
      { x: 10, y: 10, code: 34, font: font },
      { x: 10, y: 20, code: 35, font: font }
    ])
    Zlib::Inflate.stub(:inflate, "ttf") do
      TTFunk::File.stub(:open, ->(*) { ttf }) do
        assert_equal({ numerator: 2, denominator: 4 }, receiver.time_signature)
      end
    end

    receiver.instance_variable_set(:@time_signature_symbols, [
      { x: 10, y: 10, code: 34, font: font },
      { x: 10, y: 20, code: 34, font: font }
    ])
    assert_equal({ numerator: 4, denominator: 4 }, receiver.time_signature)

    receiver.instance_variable_set(:@time_signature_symbols, [
      { x: 10, y: 10, code: 33, font: font },
      { x: 10, y: 20, code: 34, font: font }
    ])
    [ [ 200, 4 ], [ 300, 3 ], [ 400, 2 ] ].each do |width, expected|
      ttf.define_singleton_method(:find_glyph) { |_index| Struct.new(:x_min, :x_max).new(0, width) }
      Zlib::Inflate.stub(:inflate, "ttf") do
        TTFunk::File.stub(:open, ->(*) { ttf }) do
          assert_equal expected, receiver.time_signature.fetch(:numerator)
        end
      end
    end

    receiver.instance_variable_set(:@time_signature_symbols, [])
    assert_nil receiver.time_signature

    broken_font = Object.new
    receiver.instance_variable_set(:@time_signature_symbols, [
      { x: 10, y: 10, code: 33, font: broken_font },
      { x: 10, y: 20, code: 34, font: broken_font }
    ])
    assert_nil receiver.time_signature
  end

  private

  def with_reader(pages)
    reader = FakeReader.new(pages)
    Tef2::PdfRecognizer::PageReceiver.stub(:new, FakeReceiver.new) do
      PDF::Reader.stub(:new, reader) { yield }
    end
  end

  def empty_page
    FakePage.new([], [], 612, 792)
  end

  def staff_page(title: nil, tuning: nil, extra_texts: [], note_texts: nil, flat_symbols_data: nil)
    texts = []
    texts << [ 100, 750, title ] if title
    texts << [ 150, 740, tuning ] if tuning
    texts.concat(extra_texts)
    texts.concat(note_texts || [ [ 40, 636.4, "0" ] ])
    runs = texts.map { |x, y, text| FakeRun.new(x, y, text, text.to_s.length * 5) }
    segments = []
    [ 600, 610, 620, 630, 640 ].each do |y|
      segments << [ 20, y, 580, y ]
    end
    [ 20, 300, 580 ].each do |x|
      segments << [ x, 600, x, 640 ]
    end
    FakePage.new(runs, segments, 612, 792, flat_symbols_data)
  end
end
