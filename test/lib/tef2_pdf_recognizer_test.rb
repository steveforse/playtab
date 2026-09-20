require "test_helper"
require "tef2/pdf_recognizer"
require "tef2/pdf_musicxml_builder"
require "tef2/pdf_raster_recognizer"

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

  test "does not read letter-spaced page words as technique marks" do
    page = staff_page(
      tuning: "gDGBD tuning",
      note_texts: [ [ 40, 636.4, "0" ], [ 80, 636.4, "2" ] ],
      extra_texts: [
        [ 45, 605, "shanties" ],
        [ 150, 605, "High solo" ],
        [ 250, 605, "Verse" ]
      ]
    )
    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf")
      assert_empty result[:techniques]
    end
  end

  test "captures letter fingerings printed below the staff" do
    page = staff_page(
      note_texts: [ [ 40, 636.4, "2" ], [ 80, 636.4, "3" ] ],
      extra_texts: [ [ 40, 670, "T" ], [ 80, 670, "I" ] ]
    )
    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf")
      assert_equal [ "I", "T" ], result[:fingerings].map { |item| item[:value] }.sort
      assert_empty result[:sections]
    end
  end

  test "still reads isolated single-letter technique marks next to chord names" do
    page = staff_page(
      tuning: "gDGBD tuning",
      note_texts: [ [ 40, 636.4, "0" ], [ 80, 636.4, "2" ] ],
      extra_texts: [
        [ 45, 605, "s" ],
        [ 85, 610, "H" ],
        [ 100, 610, "D" ],
        [ 110, 610, "Maj" ]
      ]
    )
    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf")
      assert_equal %w[hammer-on slide], result[:techniques].map { |technique| technique[:type] }.sort
    end
  end

  test "splits clustered pull-off marks fused into one text token" do
    page = staff_page(
      tuning: "gDGBD tuning",
      note_texts: [ [ 40, 636.4, "5" ], [ 55, 636.4, "3" ], [ 80, 636.4, "1" ] ],
      extra_texts: [ [ 45, 623, "PoPo" ] ]
    )
    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf")
      assert_equal 2, result[:techniques].count { |technique| technique[:type] == "pull-off" }
    end
  end

  test "does not split chord names or words into technique marks" do
    page = staff_page(
      tuning: "gDGBD tuning",
      note_texts: [ [ 40, 636.4, "0" ], [ 80, 636.4, "2" ] ],
      extra_texts: [
        [ 45, 610, "Bb" ],
        [ 150, 610, "High" ],
        [ 250, 610, "Verse" ]
      ]
    )
    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf")
      assert_empty result[:techniques]
    end
  end

  test "decomposes clustered technique tokens conservatively" do
    recognizer = Tef2::PdfRecognizer.new
    assert_equal [ "po", "po" ], recognizer.send(:clustered_mark_pieces, "PoPo")
    assert_equal [ "h", "po" ], recognizer.send(:clustered_mark_pieces, "HPo")
    assert_equal [ "ho", "h" ], recognizer.send(:clustered_mark_pieces, "hoh")
    assert_equal [ "h", "h" ], recognizer.send(:clustered_mark_pieces, "hh")
    assert_equal [ "t", "t" ], recognizer.send(:clustered_mark_pieces, "tt")
    assert_nil recognizer.send(:clustered_mark_pieces, "Po")
    assert_nil recognizer.send(:clustered_mark_pieces, "Bb")
    assert_nil recognizer.send(:clustered_mark_pieces, "High")
    assert_nil recognizer.send(:clustered_mark_pieces, "Verse")
    assert_nil recognizer.send(:clustered_mark_pieces, "shanties")
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

  test "rejects vector-drawing-only PDFs without selectable text" do
    # A full staff drawn as pure vector paths (no text runs): the recognizer must
    # reject it with a clear message instead of running slow staff detection.
    vector_only_page = FakePage.new(
      [],
      [ [ 20, 600, 580, 600 ], [ 20, 610, 580, 610 ], [ 20, 620, 580, 620 ], [ 20, 630, 580, 630 ], [ 20, 640, 580, 640 ],
        [ 20, 600, 20, 640 ], [ 580, 600, 580, 640 ] ],
      612, 792
    )
    with_reader([ vector_only_page ]) do
      Tef2::PdfRasterRecognizer.stub(:recognize, ->(*) { raise Tef2::PdfRecognizer::Error, "raster fallback failed" }) do
        error = assert_raises(Tef2::PdfRecognizer::Error) { Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf") }
        assert_equal "raster fallback failed", error.message
      end
    end

    text_only_page = FakePage.new([ FakeRun.new(100, 750, "Demo", 20) ], [], 612, 792)
    with_reader([ text_only_page ]) do
      Tef2::PdfRasterRecognizer.stub(:recognize, ->(*) { raise Tef2::PdfRecognizer::Error, "raster fallback failed" }) do
        error = assert_raises(Tef2::PdfRecognizer::Error) { Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "Demo.pdf") }
        assert_equal "raster fallback failed", error.message
      end
    end
  end

  test "rejects PDFs without systems or notes" do
    no_systems = FakeReader.new([ empty_page ])
    with_reader(no_systems.pages) do
      Tef2::PdfRasterRecognizer.stub(:recognize, ->(*) { raise Tef2::PdfRecognizer::Error, "raster fallback failed" }) do
        assert_raises(Tef2::PdfRecognizer::Error) { Tef2::PdfRecognizer.recognize("%PDF-1.7") }
      end
    end

    no_notes = FakeReader.new([ staff_page(note_texts: []) ])
    with_reader(no_notes.pages) do
      assert_raises(Tef2::PdfRecognizer::Error) { Tef2::PdfRecognizer.recognize("%PDF-1.7") }
    end
  end

  test "preserves silence stems alongside recognized note positions" do
    page = staff_page(
      note_texts: [ [ 40, 636.4, "0" ], [ 80, 636.4, "2" ] ],
      extra_segments: [ [ 60, 585, 60, 595 ] ]
    )

    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "rests.pdf")

      assert_equal 1, result[:rests].length
      assert_equal 0, result[:rests].first[:measure]
      assert result[:rests].first[:position].positive?
    end
  end

  test "uses printed rest glyphs as timing events" do
    page = staff_page(
      note_texts: [ [ 40, 636.4, "0" ], [ 80, 636.4, "2" ] ],
      extra_texts: [ [ 60, 620, "\uF051" ] ]
    )

    with_reader([ page ]) do
      result = Tef2::PdfRecognizer.recognize("%PDF-1.7 synthetic", filename: "rests.pdf")

      assert_equal [ 0, 512 ], result[:notes].select { |note| note[:measure] == 0 }.map { |note| note[:position] }
      assert_equal [ 256 ], result[:rests].select { |rest| rest[:measure] == 0 }.map { |rest| rest[:position] }
    end
  end

  test "keeps the Andy Griffith PDF rhythm, endings, pull-offs, and thumb target when supplied" do
    path = ENV["PLAYTAB_ANDY_GRIFFITH_PDF"]
    skip "Set PLAYTAB_ANDY_GRIFFITH_PDF for the private Andy Griffith regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    notes_for = ->(measure) { score[:notes].select { |note| note[:measure] == measure }.map { |note| note[:position] } }
    techniques_for = ->(measure) {
      score[:techniques].select { |technique| technique[:measure] == measure }.map {
        |technique| [ technique[:position], technique[:string], technique[:type] ]
      }
    }

    assert_equal [ 640, 768 ], notes_for.call(0)
    assert_equal [ 0, 256, 512, 768 ], notes_for.call(11)
    assert_equal [ 0, 256, 512, 768 ], notes_for.call(13)
    assert_equal [ [ 0, 0, "pull-off" ], [ 640, 2, "hammer-on" ], [ 768, 2, "pull-off" ] ], techniques_for.call(4)
    assert_equal [ [ 768, 0, "pull-off" ] ], techniques_for.call(15)
    assert_equal [ [ 0, 0, "pull-off" ], [ 640, 2, "hammer-on" ], [ 768, 2, "pull-off" ] ], techniques_for.call(21)
    assert_equal [ "1", "2" ], score[:endings].sort_by { |ending| ending[:measure] }.map { |ending| ending[:number] }
    assert_equal [ [ 896, 1, "thumb" ] ], techniques_for.call(23)
    assert_equal [ 0 ], notes_for.call(25)
    assert_empty score[:rests].select { |rest| rest[:measure] == 25 }
  end

  test "keeps the Arkansas Traveler legato, rake, multi-digit frets, and final measure when supplied" do
    path = ENV["PLAYTAB_ARKANSAS_TRAVELER_PDF"]
    skip "Set PLAYTAB_ARKANSAS_TRAVELER_PDF for the private Arkansas Traveler regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    techniques_for = ->(measure) {
      score[:techniques].select { |technique| technique[:measure] == measure }.map {
        |technique| [ technique[:position], technique[:string], technique[:type] ]
      }
    }
    notes_for = ->(measure) { score[:notes].select { |note| note[:measure] == measure } }

    assert_equal 25, score[:measures]
    assert_nil score[:lyrics]
    assert_includes techniques_for.call(2), [ 256, 0, "hammer-on" ]
    assert_includes techniques_for.call(3), [ 0, 0, "hammer-on" ]
    assert_includes techniques_for.call(6), [ 256, 2, "hammer-on" ]
    assert_includes techniques_for.call(16), [ 384, 0, "rake" ]
    assert_includes techniques_for.call(18), [ 0, 0, "hammer-on" ]
    assert_includes notes_for.call(22).map { |note| note[:fret] }, 10
    assert_includes notes_for.call(23).map { |note| note[:fret] }, 10
    assert_equal [ 7, 0, 7, 0, 0 ], notes_for.call(24).map { |note| note[:fret] }
  end

  test "keeps the Ashokan Farewell slide label when supplied" do
    path = ENV["PLAYTAB_ASHOKAN_FAREWELL_PDF"]
    skip "Set PLAYTAB_ASHOKAN_FAREWELL_PDF for the private Ashokan Farewell regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    slide = score[:techniques].find { |technique| technique[:measure] == 15 && technique[:type] == "slide" }

    assert_equal({ measure: 15, position: 320, string: 1, type: "slide", label: "Sl", confidence: "medium" }, slide)
  end

  test "keeps the Big Rock Candy Mountain opening slide and measure 62 pull-off when supplied" do
    path = ENV["PLAYTAB_BIG_ROCK_CANDY_MOUNTAIN_PDF"]
    skip "Set PLAYTAB_BIG_ROCK_CANDY_MOUNTAIN_PDF for the private Big Rock Candy Mountain regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    techniques_for = ->(measure) {
      score[:techniques].select { |technique| technique[:measure] == measure }.map {
        |technique| [ technique[:position], technique[:string], technique[:type], technique[:label] ]
      }
    }

    assert_includes techniques_for.call(0), [ 448, 0, "slide", "s" ]
    assert_includes techniques_for.call(61), [ 384, 3, "pull-off", "Po" ]
  end

  test "keeps the Cumberland Gap measure 14 slide on its final two notes when supplied" do
    path = ENV["PLAYTAB_CUMBERLAND_GAP_PDF"]
    skip "Set PLAYTAB_CUMBERLAND_GAP_PDF for the private Cumberland Gap regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    assert_equal [ 0, 64, 128, 192, 256, 384, 448 ], score[:notes].select { |note| note[:measure] == 0 }.map { |note| note[:position] }.uniq
    assert_empty score[:rests].select { |rest| rest[:measure] == 0 }
    slide = score[:techniques].find { |technique| technique[:measure] == 13 && technique[:type] == "slide" }

    assert_equal({ measure: 13, position: 384, string: 1, type: "slide", label: "Sl", confidence: "medium" }, slide)
  end

  test "preserves Skeleton Dance's dotted opening measure when supplied" do
    path = ENV["PLAYTAB_SKELETON_DANCE_PDF"]
    skip "Set PLAYTAB_SKELETON_DANCE_PDF for the private Skeleton Dance regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    assert_equal "gCGBD", score[:tuning_label]
    assert_equal [ 0, 192, 256, 448, 512, 768 ], score[:notes].select { |note| note[:measure] == 0 }.map { |note| note[:position] }.uniq
    assert_empty score[:rests].select { |rest| rest[:measure] == 0 }
  end

  test "preserves Skeleton Dance's later dotted measures and right-hand fingerings when supplied" do
    path = ENV["PLAYTAB_SKELETON_DANCE_PDF"]
    skip "Set PLAYTAB_SKELETON_DANCE_PDF for the private Skeleton Dance regression PDF." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))
    notes_for = ->(measure) { score[:notes].select { |note| note[:measure] == measure }.map { |note| note[:position] }.uniq }
    fingerings_for = ->(measure) {
      score[:fingerings].select { |fingering| fingering[:measure] == measure }
        .sort_by { |fingering| fingering[:position] }
        .map { |fingering| fingering[:value] }
    }

    assert_equal [ 0, 192, 256, 448, 512, 768 ], notes_for.call(1)
    assert_equal [ 0, 192, 256, 448, 512, 704, 768, 960 ], notes_for.call(2)
    assert_equal [ 0, 192, 256, 448, 512, 704, 768 ], notes_for.call(3)
    assert_equal notes_for.call(4), notes_for.call(5)
    assert_equal [ 0, 256, 341, 427, 512, 768 ], notes_for.call(45)
    assert_equal [ 256, 341, 427 ], score[:notes].select { |note| note[:measure] == 45 && note[:tuplet] }.map { |note| note[:position] }.uniq
    assert_equal notes_for.call(45), notes_for.call(69)
    assert_equal [ 0, 192, 256, 448, 512, 704, 768, 960 ], notes_for.call(6)
    assert_equal [ 0, 96, 192, 256, 352, 448, 512, 768 ], notes_for.call(54)
    assert_equal [ 768 ], score[:notes].select { |note| note[:measure] == 54 && note[:tuplet] }.map { |note| note[:position] }.uniq
    assert_equal [ 853, 939 ], score[:rests].select { |rest| rest[:measure] == 54 }.map { |rest| rest[:position] }
    assert_empty score[:fingerings].select { |fingering| fingering[:measure] == 54 && fingering[:value] == "3" }
    assert_equal [ 0, 192, 224, 256, 448, 480, 512, 704, 736, 768, 960, 992 ], notes_for.call(56)
    assert_equal [ 0, 512 ], notes_for.call(81)
    assert_equal [ 256, 768 ], score[:rests].select { |rest| rest[:measure] == 81 }.map { |rest| rest[:position] }
    assert_equal [ 0, 256 ], notes_for.call(82)
    assert_equal [ 512 ], score[:rests].select { |rest| rest[:measure] == 82 }.map { |rest| rest[:position] }
    assert_empty score[:rests].select { |rest| rest[:measure] < 4 }
    assert_includes fingerings_for.call(0), "I"
    assert_includes fingerings_for.call(3), "M"

    slides = score[:techniques].select { |technique| [ 52, 53 ].include?(technique[:measure]) && technique[:type] == "slide" }
    assert_equal [ [ 52, 0, 3 ], [ 53, 0, 3 ] ], slides.map { |slide| slide.values_at(:measure, :position, :string) }

    ties = score[:ties].select { |tie| tie[:measure] == 47 }
    assert_equal [ [ 1, "start" ], [ 1, "stop" ], [ 2, "start" ], [ 2, "stop" ], [ 3, "start" ], [ 3, "stop" ] ],
      ties.map { |tie| tie.values_at(:string, :type) }
  end

  test "imports the private Whisky Before Breakfast vector PDF when supplied" do
    path = ENV["PLAYTAB_WHISKY_BEFORE_BREAKFAST_PDF"]
    skip "Set PLAYTAB_WHISKY_BEFORE_BREAKFAST_PDF for the private vector-PDF regression." unless path && File.file?(path)

    score = Tef2::PdfRecognizer.recognize(File.binread(path), filename: File.basename(path))

    assert_equal 16, score[:measures]
    assert_equal 119, score[:notes].length
    assert_equal 2, score[:capo]
    assert_equal "gCGCD", score[:tuning_label]
    assert_equal "Whisky Before Breakfast", score[:title]
    assert_equal "www.PlayBetterBanjo.com", score[:subtitle]
    assert_equal "Arranged by Ryan Spearman", score[:arranger]
    assert_equal %w[m m m m t m m t m m t m m t m m t m m m m t], score[:fingerings]
      .select { |fingering| fingering[:measure].between?(0, 3) }
      .sort_by { |fingering| [ fingering[:measure], fingering[:position] ] }
      .map { |fingering| fingering[:value] }
    assert_equal 84, score[:fingerings].length
    assert_equal [
      [ 2, 256, "up" ], [ 2, 768, "up" ], [ 6, 256, "up" ], [ 6, 768, "up" ],
      [ 7, 768, "up" ], [ 8, 768, "up" ], [ 9, 256, "up" ],
      [ 14, 256, "up" ], [ 14, 768, "up" ], [ 15, 768, "up" ]
    ], score[:strums].map { |strum| strum.values_at(:measure, :position, :direction) }
    assert score[:notes].all? { |note| note[:position].between?(0, 960) }
    assert_equal [
      [ 0, 3, 0 ], [ 256, 3, 4 ], [ 512, 2, 0 ], [ 768, 2, 0 ], [ 896, 4, 0 ]
    ], score[:notes].select { |note| note[:measure] == 0 }
      .sort_by { |note| note[:position] }
      .map { |note| note.values_at(:position, :string, :fret) }
    assert_equal [ 0, 256, 384, 512, 768, 896 ], score[:notes].select { |note| [ 2, 6 ].include?(note[:measure]) }
      .group_by { |note| note[:measure] }.values.map { |notes| notes.map { |note| note[:position] }.uniq }
      .first
    assert_equal [ 0, 256, 384, 512, 768, 896 ], score[:notes].select { |note| note[:measure] == 6 }
      .map { |note| note[:position] }.uniq
    assert_equal [ 0, 128, 256, 384, 512, 768, 896 ], score[:notes].select { |note| note[:measure] == 7 }
      .map { |note| note[:position] }.uniq
    assert_equal [
      [ 0, 3, 0 ], [ 128, 3, 4 ], [ 256, 2, 0 ], [ 384, 2, 2 ],
      [ 512, 1, 0 ], [ 768, 1, 0 ], [ 768, 2, 0 ], [ 896, 4, 0 ]
    ], score[:notes].select { |note| note[:measure] == 8 }
      .sort_by { |note| [ note[:position], note[:string] ] }
      .map { |note| note.values_at(:position, :string, :fret) }
    assert_equal [
      [ 0, 1, 0 ], [ 256, 0, 2 ], [ 256, 1, 0 ], [ 384, 4, 0 ],
      [ 512, 2, 2 ], [ 640, 2, 0 ], [ 768, 2, 0 ], [ 896, 4, 0 ]
    ], score[:notes].select { |note| note[:measure] == 9 }
      .sort_by { |note| [ note[:position], note[:string] ] }
      .map { |note| note.values_at(:position, :string, :fret) }
    assert_equal [
      [ 0, 0, 0 ], [ 0, 1, 2 ], [ 256, 1, 2 ], [ 384, 1, 4 ],
      [ 512, 1, 2 ], [ 768, 1, 2 ], [ 896, 1, 4 ]
    ], score[:notes].select { |note| note[:measure] == 10 }
      .sort_by { |note| [ note[:position], note[:string] ] }
      .map { |note| note.values_at(:position, :string, :fret) }
    assert_equal [
      [ 0, 0, 3 ], [ 128, 0, 2 ], [ 256, 0, 0 ], [ 384, 1, 0 ],
      [ 512, 2, 4 ], [ 640, 2, 0 ], [ 768, 2, 2 ], [ 896, 2, 4 ]
    ], score[:notes].select { |note| note[:measure] == 11 }
      .sort_by { |note| [ note[:position], note[:string] ] }
      .map { |note| note.values_at(:position, :string, :fret) }
    assert_equal [
      [ "pull-off", 0, 0 ], [ "pull-off", 512, 2 ], [ "hammer-on", 768, 2 ]
    ], score[:techniques].select { |technique| technique[:measure] == 11 }
      .map { |technique| technique.values_at(:type, :position, :string) }
    assert_equal [ { measure: 10, position: 0, string: 1, type: "slide-in", label: "/" } ],
      score[:techniques].select { |technique| technique[:type] == "slide-in" }
    assert_equal [
      { measure: 7, location: "right", direction: "end" },
      { measure: 8, location: "left", direction: "start" },
      { measure: 15, location: "right", direction: "end" }
    ], score[:repeats]
    assert_includes score[:chords].map { |chord| chord[:name] }, "Dm"
    assert_includes score[:chords].map { |chord| chord[:name] }, "G"
    assert score[:techniques].any? { |technique| technique[:type] == "hammer-on" }
    assert_equal [
      [ "hammer-on", 0, 2 ], [ "pull-off", 512, 3 ]
    ], score[:techniques].select { |technique| technique[:measure] == 1 }
      .map { |technique| technique.values_at(:type, :position, :string) }

    xml = Tef2::PdfMusicxmlBuilder.build(score)
    document = Nokogiri::XML(xml)
    assert_empty document.errors
    assert_equal [ "2" ], document.xpath("//measure[1]/attributes/staff-details/capo").map(&:text)
    assert_empty document.xpath("//note/duration[text()='0']")
    assert_equal [ "backward", "forward", "backward" ], document.xpath("//part/measure/barline/repeat").map { |repeat| repeat["direction"] }
    assert_equal [ "www.PlayBetterBanjo.com" ], document.xpath("//credit[credit-type='subtitle']/credit-words").map(&:text)
    assert_equal [ "Arranged by Ryan Spearman" ], document.xpath("//credit[credit-type='arranger']/credit-words").map(&:text)
    assert_equal [ "TEF slide /" ], document.xpath("//measure[11]//other-technical[starts-with(text(), 'TEF slide')]").map(&:text)
    assert_equal 8, document.xpath("//other-technical[starts-with(text(), 'TEF strum')]").length
  end

  test "uses the merged page text for technique markers" do
    recognizer = Tef2::PdfRecognizer.new
    system = {
      page: 0, top: 100, bottom: 140, bars: [ 20, 100 ], measure_start: 0, measure_ticks: 1024,
      events: [
        { x: 30, notes: [ { x: 30, string: 1, fret: 0 } ] },
        { x: 40, notes: [ { x: 40, string: 1, fret: 2 } ] }
      ],
      texts: []
    }
    pages = [ { texts: [ { x: 35, y: 144, text: "H" }, { x: 36, y: 155, text: "B" } ], segments: [], curve_boxes: [], systems: [] } ]

    metadata = recognizer.send(:metadata, pages, [ system ])

    assert_equal 1, metadata[:techniques].length
    assert_equal "hammer-on", metadata[:techniques].first[:type]
    assert_equal 0, metadata[:techniques].first[:measure]
  end

  test "infers tuning from the five labels beside the first tablature staff" do
    recognizer = Tef2::PdfRecognizer.new
    system = {
      top: 100, bottom: 140, bars: [ 20, 100 ],
      texts: [
        { x: 27, y: 140, text: "D" }, { x: 27, y: 130, text: "B" }, { x: 27, y: 120, text: "G" },
        { x: 27, y: 110, text: "C" }, { x: 27, y: 100, text: "G" }
      ]
    }

    assert_equal "gCGBD", recognizer.send(:staff_tuning_label, system)
  end

  test "covers PDF timing regressions, metadata normalization, and layout helpers" do
    recognizer = Tef2::PdfRecognizer.new
    assert_equal 0, recognizer.send(:position, 20, 20, 300)
    assert_equal 512, recognizer.send(:position, 160, 20, 300)
    assert_equal 896, recognizer.send(:position, 300, 20, 300)
    assert_equal 64, recognizer.send(:position_step, 20, 220, [ 45, 56.5, 68 ])
    assert_equal 32, recognizer.send(:position_step, 20, 220, [ 45, 53, 61, 69 ])
    assert_equal 128, recognizer.send(:position_step, 20, 220, [ 45, 100 ])
    dense_six_eight_xs = [ 10.0, 28.0, 40.0, 52.0, 69.0, 87.0, 99.0, 111.0, 123.0 ]
    assert_equal 64, recognizer.send(:position_step, 0, 134, dense_six_eight_xs, measure_ticks: 768)
    assert_equal [ 0, 128, 192, 256, 384, 512, 576, 640, 704 ], recognizer.send(
      :spacing_rhythm_positions, 0, 134, dense_six_eight_xs, 768, 64
    )
    # Wellerman's ordinary eighth-note spacing must stay on the 128-tick grid.
    assert_equal 128, recognizer.send(:position_step, 20, 150, [ 35, 52, 69 ])
    # Its isolated pickup is a quarter-note event even though it is printed late in the bar.
    assert_equal 768, recognizer.send(:position, 125, 20, 150, step: 128, event_xs: [ 125 ], measure_ticks: 1024,
      layout: { left_margin: 12, right_margin: 4, usable: 114 })
    assert_equal "C#", recognizer.send(:normalize_chord, "c #")
    assert_equal "C min", recognizer.send(:normalize_chord, "C m")
    assert_equal "G7", recognizer.send(:normalize_chord, "G7")
    assert_equal "", recognizer.send(:normalize_chord, "not a chord")
    assert_equal "hammer-on", recognizer.send(:technique_type, "Hammer-On")
    assert_equal "pull-off", recognizer.send(:technique_type, "p_o")
    assert_equal "rake", recognizer.send(:technique_type, "R")
    assert_nil recognizer.send(:technique_type, "unknown")
    technique_system = {
      top: 0,
      bottom: 100,
      bars: [ 0, 100 ],
      measure_start: 0,
      measure_ticks: 1024,
      measure_layouts: nil,
      measure_rhythm_positions: nil,
      events: [
        { x: 10, notes: [ { x: 10, string: 1, fret: 0 }, { x: 10, string: 3, fret: 3 } ] },
        { x: 20, notes: [ { x: 20, string: 3, fret: 0 } ] }
      ]
    }
    pull_off = recognizer.send(:techniques_for_system, technique_system, [ { x: 15, y: 50, text: "Po" } ]).first
    assert_equal({ measure: 0, position: 0, string: 3, type: "pull-off", label: "Po", confidence: "high" }, pull_off)
    split_pull_off = recognizer.send(:techniques_for_system, technique_system, [
      { x: 15, y: 50, text: "P" }, { x: 20.3, y: 50, text: "o" }
    ]).first
    assert_equal({ measure: 0, position: 0, string: 3, type: "pull-off", label: "Po", confidence: "high" }, split_pull_off)
    ambiguous_technique_system = technique_system.merge(
      bars: [ 0, 100, 200 ],
      events: [
        { x: 20, notes: [ { x: 20, string: 1, fret: 2 } ] },
        { x: 80, notes: [ { x: 80, string: 3, fret: 4 } ] },
        { x: 88, notes: [ { x: 88, string: 3, fret: 2 } ] },
        { x: 144.6, notes: [ { x: 144.6, string: 1, fret: 0 } ] }
      ]
    )
    centered_pull_off = recognizer.send(:techniques_for_system, ambiguous_technique_system, [
      { x: 80, y: 50, text: "P" }, { x: 85, y: 50, text: "o" }
    ]).first
    assert_equal 3, centered_pull_off[:string]
    split_slide = recognizer.send(:techniques_for_system, technique_system, [
      { x: 15, y: 50, text: "S" }, { x: 20.3, y: 50, text: "l" }
    ]).first
    assert_equal({ measure: 0, position: 0, string: 3, type: "slide", label: "Sl", confidence: "medium" }, split_slide)
    thumb = recognizer.send(:techniques_for_system, technique_system.merge(measure_rhythm_positions: [ [ 0, 256 ] ]), [
      { x: 20, y: 50, text: "T" }
    ]).first
    assert_equal({ measure: 0, position: 256, string: 3, type: "thumb", label: "T", confidence: "high" }, thumb)
    rake = recognizer.send(:techniques_for_system, technique_system, [ { x: 10, y: 50, text: "R" } ]).first
    assert_equal({ measure: 0, position: 0, string: 1, type: "rake", label: "R", confidence: "high" }, rake)
    assert_equal [ { x: 10, y: 20, text: "10", end_x: 15.2 } ], recognizer.send(:merge_multi_digit_frets, [
      { x: 10, y: 20, text: "1" }, { x: 15.2, y: 20, text: "0" }
    ])
    assert recognizer.send(:technique_direction_valid?, "slide", { fret: 3 }, { fret: 0 })
    assert_equal "Demo", recognizer.send(:filename_without_extension, "C:\\tabs\\Demo.pdf")
    assert_equal({ title: "Demo", tuning: "gCGCD#", subtitle: "gCGCD# tuning", arranger: "" }, recognizer.send(:header, [ { x: 100, y: 750, text: "Demo" }, { x: 150, y: 740, text: "gCGCD# tuning" } ]))
    assert_equal({ title: "Demo", tuning: "aDADE", subtitle: "key of D (aDADE tuning)", arranger: "" }, recognizer.send(:header, [ { x: 100, y: 750, text: "Demo" }, { x: 150, y: 720, text: "key of D (aDADE tuning)" } ]))
    assert_equal({ title: "Drunken Sailor", tuning: "gCGCD#", subtitle: "gCGCD# (capo 2), Brainjo level 3", arranger: "arranged by Josh Turknett CLAWHAMMERBANJO.NET" }, recognizer.send(:header, [
      { x: 256, y: 752, text: "Drunken Sailor" },
      { x: 222, y: 740, text: "gCGCD# (capo 2), Brainjo level 3" },
      { x: 491, y: 731, text: "arranged by Josh Turknett" },
      { x: 479, y: 723, text: "CLAWHAMMERBANJO.NET" }
    ]))
    assert_nil recognizer.send(:tempo, [ { texts: [ { x: 10, y: 100, text: "unrelated" } ] } ])

    assert_equal 2, recognizer.send(:beam_count_for_event, 50, [ [ 45, 80, 60, 80 ], [ 45, 82, 60, 82 ] ], 100)
    assert_nil recognizer.send(:beam_count_for_event, 50, [ [ 45, 98, 60, 98 ] ], 100)
    events = [ 2, 2, 1, 1, 1 ].each_with_index.map { |beam_count, index| { x: 10 + index * 10, beam_count: beam_count } }
    assert_equal [ 0, 64, 128, 256, 384 ], recognizer.send(:beam_rhythm_positions, 0, 100, events, 512)
    assert_equal [ 640, 768 ], recognizer.send(:beam_rhythm_positions, 0, 100, [
      { x: 70, beam_count: 1 }, { x: 85, beam_count: nil }
    ], 1024)
    assert_equal [ 0, 256, 512, 640, 768 ], recognizer.send(:beam_rhythm_positions, 0, 100, [
      { x: 10, beam_count: nil }, { x: 20, beam_count: nil }, { x: 30, beam_count: 1 },
      { x: 40, beam_count: 1 }, { x: 50, beam_count: nil }
    ], 1024)
    assert_equal [ 0, 256, 512, 768 ], recognizer.send(:beam_rhythm_positions, 0, 100, [
      { x: 10, beam_count: nil }, { x: 20, beam_count: nil }, { x: 30, beam_count: nil },
      { x: 40, beam_count: nil }
    ], 1024)
    assert_equal [ 0, 64, 128, 192, 256, 384, 448 ], recognizer.send(:beam_rhythm_positions, 0, 100, [
      { x: 10, beam_count: 2 }, { x: 20, beam_count: 2 }, { x: 30, beam_count: 2 }, { x: 40, beam_count: 2 },
      { x: 55, beam_count: 1 }, { x: 65, beam_count: 2 }, { x: 75, beam_count: 2 }
    ], 512)
    assert_equal [ 0 ], recognizer.send(:beam_rhythm_positions, 0, 100, [ { x: 10, beam_count: nil } ], 1024)
    # A missed beam line overfills the measure under the quarter-note
    # default; the unique assignment that fills it recovers the rhythm.
    assert_equal [ 0, 64, 128, 192, 256, 384 ], recognizer.send(:beam_rhythm_positions, 156.9, 243.2, [
      { x: 163.9, beam_count: nil }, { x: 174.7, beam_count: 2 }, { x: 186.3, beam_count: 2 },
      { x: 198.9, beam_count: 2 }, { x: 207.1, beam_count: 1 }, { x: 224.4, beam_count: 1 }
    ], 512)
    # Several assignments fill the measure; the x-gap pattern selects the one
    # whose durations are proportional to the printed onsets.
    assert_equal [ 0, 128, 192, 256, 384, 448 ], recognizer.send(:beam_rhythm_positions, 307.7, 398.4, [
      { x: 318.0, beam_count: 1 }, { x: 335.3, beam_count: 1 }, { x: 346.8, beam_count: 2 },
      { x: 358.3, beam_count: 1 }, { x: 375.6, beam_count: 2 }, { x: 387.1, beam_count: 2 }
    ], 512)
    # Symmetric gaps cannot rank the assignments, so keep the safe fallback.
    assert_nil recognizer.send(:beam_rhythm_positions, 0, 100, [
      { x: 10, beam_count: nil }, { x: 40, beam_count: nil }, { x: 70, beam_count: 1 }
    ], 512)
    # No detected beam at all: no evidence, so leave the measure to spacing.
    assert_nil recognizer.send(:beam_rhythm_positions, 0, 100, [
      { x: 10, beam_count: nil }, { x: 30, beam_count: nil }, { x: 50, beam_count: nil }
    ], 512)
    # A shared beam crossing a quarter-note boundary must use measured spacing.
    uneven_beams = [ 0, 10, 25 ].map { |x| { x: x, beam_count: 1 } }
    assert_nil recognizer.send(:beam_rhythm_positions, 0, 100, uneven_beams, 1024)
    assert_equal [ 0, 64, 128, 192, 256, 384 ], recognizer.send(:spacing_rhythm_positions, 308, 395, [ 318.03, 328.43, 340.34, 350.74, 361.53, 378.8 ], 512, 64)
    assert_equal [ 0, 128, 192, 256 ], recognizer.send(:spacing_rhythm_positions, 132, 205, [ 141.74, 158.29, 169.08, 179.88 ], 512, 64)
    assert_equal [ 0, 128, 192, 256, 384, 448 ], recognizer.send(:spacing_rhythm_positions, 272, 373, [ 283.81, 302.52, 315.48, 328.43, 347.14, 360.09 ], 512, 64)

    dotted_xs = [ 10.0, 35.0, 47.0, 65.0, 83.0, 101.0 ]
    assert_equal [ 0, 192, 256, 384, 512, 640 ], recognizer.send(
      :spacing_rhythm_positions, 0, 110, dotted_xs, 768, 64, dotted_indices: [ 0 ]
    )
    dotted_events = [
      { x: 10, dotted: true }, { x: 35, dotted: false }, { x: 47, dotted: true },
      { x: 65, dotted: false }, { x: 83, dotted: false }, { x: 101, dotted: false }
    ]
    assert_equal [ 0, 192, 256, 448, 512, 640 ], recognizer.send(
      :dotted_rhythm_positions, 0, 110, dotted_events, 768, 64, [ 0, 2 ]
    )
    triplet_xs = [ 10.0, 27.0, 38.0, 49.0, 66.0, 77.0, 88.0, 99.0, 110.0, 117.9, 125.9 ]
    assert_equal [ 0, 128, 192, 256, 384, 448, 512, 576, 640, 672, 704 ], recognizer.send(
      :spacing_rhythm_positions, 0, 130, triplet_xs, 768, 64, triplet_starts: [ 8 ]
    )
    assert_nil recognizer.send(
      :beamed_dotted_rhythm_positions, [ {}, {}, {} ], 1024, 32, [ 0, 1 ]
    )

    dot_boxes = [
      { x: 22.0, y: 90.0, width: 1, height: 1 }, { x: 23.0, y: 90.5, width: 1, height: 1 },
      { x: 22.5, y: 91.0, width: 1, height: 1 }, { x: 23.5, y: 91.0, width: 1, height: 1 }
    ]
    dotted_system = { top: 100, curve_boxes: dot_boxes }
    dotted_events = [ { x: 15, notes: [ { string: 0 } ] }, { x: 40, notes: [ { string: 0 } ] } ]
    assert_equal [ 0 ], recognizer.send(:dotted_event_indices, dotted_system, dotted_events, 0, 100)
    assert_equal [ { x: 22.75, y: 90.625 } ], recognizer.send(:curve_dot_centers, dot_boxes)
    assert_empty recognizer.send(:curve_dot_centers, [ { x: 1, y: 1, width: 2, height: 2 } ])

    triplet_system = { top: 100, texts: [ { x: 30, y: 70, text: "3" } ] }
    triplet_events = [
      { x: 20, notes: [ { string: 0 } ] }, { x: 30, notes: [ { string: 0 } ] },
      { x: 40, notes: [ { string: 1 } ] }, { x: 60, notes: [ { string: 2 } ] }
    ]
    assert_equal [ 0 ], recognizer.send(:triplet_event_starts, triplet_system, triplet_events, 0, 100)
    assert_empty recognizer.send(:triplet_event_starts, { top: 100, texts: [] }, triplet_events, 0, 100)
    assert_equal [ 0, 256, 341, 427, 512, 768 ], recognizer.send(
      :triplet_rhythm_positions,
      [ 10, 20, 30, 40, 50, 60 ].map { |x| { x: x } }, 1024, [ 1 ]
    )
    tail_system = { top: 100, bottom: 130, texts: [ { x: 95, y: 155, text: "3" } ] }
    tail_events = [
      { x: 20, notes: [ { string: 0 } ] }, { x: 40, notes: [ { string: 0 } ] },
      { x: 60, notes: [ { string: 1 } ] }, { x: 80, notes: [ { string: 2 } ] }
    ]
    assert_equal [ 3 ], recognizer.send(:triplet_event_starts, tail_system, tail_events, 0, 100)
    assert_equal [ 853, 939 ], recognizer.send(
      :triplet_rest_positions, tail_events, [ 0, 256, 512, 768 ], 1024, [ 3 ]
    )

    silent_segments = [ [ 35, 85, 35, 95 ], [ 50, 85, 50, 95 ], [ 70, 85, 70, 95 ] ]
    silent_events = [ { x: 50, notes: [ { string: 0 } ] } ]
    assert_equal [ 35, 70 ], recognizer.send(:silent_stem_positions, silent_segments, 100, 20, 80, silent_events)
    silent_system = { silent_stems: [ 15, 45, 85 ] }
    timed_events = [ { x: 30, notes: [ { string: 0 } ] }, { x: 60, notes: [ { string: 0 } ] } ]
    assert_equal [ 64, 192, 320 ], recognizer.send(:silent_positions, silent_system, 0, 100, timed_events, [ 128, 256 ], 64, 512)
    assert_empty recognizer.send(:silent_positions, { silent_stems: [] }, 0, 100, timed_events, [ 128, 256 ], 64, 512)

    ending_system = { bars: [ 20, 100, 180 ], measure_start: 0, measure_layouts: [], events: [], bottom: 100 }
    endings = recognizer.send(:endings_for_system, ending_system, [
      { x: 101, y: 120, text: "1." }, { x: 105, y: 116, text: "D" }
    ])
    assert_equal [ { measure: 1, location: "left", number: "1", type: "start", confidence: "high" } ], endings
    split_endings = recognizer.send(:endings_for_system, ending_system, [
      { x: 21, y: 120, text: "1" }, { x: 26, y: 120, text: "." },
      { x: 101, y: 120, text: "2" }, { x: 106, y: 120, text: "." }
    ])
    assert_equal [ "1", "2" ], split_endings.map { |ending| ending[:number] }

    system = { top: 600, bottom: 640, bars: [ 20, 300, 580 ], measure_start: 0, events: [ { x: 40, notes: [ { x: 40, string: 0, fret: 0 } ] } ] }
    assert recognizer.send(:section_label?, system, { y: 570 }, "A section")
    refute recognizer.send(:section_label?, system, { y: 600 }, "A section")
    refute recognizer.send(:section_label?, system, { y: 570 }, "a" * 33)
    refute recognizer.send(:section_label?, system, { y: 570 }, "H")
    refute recognizer.send(:section_label?, system, { y: 570 }, "C min")
    refute recognizer.send(:section_label?, system, { y: 570 }, "T I M")
    refute recognizer.send(:section_label?, system, { y: 570 }, "arranged by someone")
    assert recognizer.send(:technique_pair_valid?, { measure: 0, position: 0, string: 0, type: "hammer-on" }, [
      { measure: 0, position: 0, string: 0, fret: 0 }, { measure: 0, position: 128, string: 0, fret: 2 }
    ])
    refute recognizer.send(:technique_pair_valid?, { measure: 0, position: 0, string: 0, type: "pull-off" }, [
      { measure: 0, position: 0, string: 0, fret: 0 }, { measure: 0, position: 128, string: 0, fret: 2 }
    ])
    refute recognizer.send(:technique_pair_valid?, { measure: 0, position: 0, string: 0, type: "hammer-on" }, [
      { measure: 0, position: 0, string: 0, fret: 0 }, { measure: 4, position: 0, string: 0, fret: 2 }
    ])
    assert Tef2::PdfRecognizer::PageReceiver.new.send(:respond_to_missing?, :anything, false)
    chord_system = { bottom: 640, bars: [ 20, 300, 580 ], measure_start: 0, events: [] }
    assert_equal 1, recognizer.send(:chords_for_system, chord_system, [ { x: 40, y: 650, text: "C" }, { x: 50, y: 650, text: "min" } ]).length

    grid_segments = [
      [ 248, 695, 263, 695 ], [ 248, 690, 263, 690 ], [ 248, 684, 263, 684 ], [ 248, 678, 263, 678 ], [ 248, 673, 263, 673 ],
      [ 248, 695, 248, 673 ], [ 253, 695, 253, 673 ], [ 258, 695, 258, 673 ], [ 263, 695, 263, 673 ]
    ]
    grid_curves = [
      { x: 248, y: 700, width: 2, height: 2 }, { x: 248, y: 701, width: 2, height: 2 }, { x: 248, y: 702, width: 2, height: 2 },
      { x: 253, y: 700, width: 2, height: 2 }, { x: 253, y: 701, width: 2, height: 2 }, { x: 253, y: 702, width: 2, height: 2 },
      { x: 258, y: 700, width: 2, height: 2 }, { x: 258, y: 701, width: 2, height: 2 }, { x: 258, y: 702, width: 2, height: 2 },
      { x: 263, y: 700, width: 2, height: 2 }, { x: 263, y: 701, width: 2, height: 2 }, { x: 263, y: 702, width: 2, height: 2 }
    ]
    diagram = recognizer.send(:chord_diagrams_for_page, [ { x: 244, y: 702, text: "D min" } ], grid_segments, grid_curves)
    assert_equal [ { name: "D min", strings: [ 0, 0, 0, 0, -1 ], first_fret: 1, confidence: "high" } ], diagram
    assert_equal 2, recognizer.send(:chord_marker_fret, { y: 686 }, { top: 695, bottom: 673, boundaries: [ 695, 690, 684, 678, 673 ] })
    assert_nil recognizer.send(:chord_marker_fret, { y: 674 }, { top: 695, bottom: 673, boundaries: [ 695, 690, 684, 678 ] })
    metadata = recognizer.send(:metadata, [ { texts: [], segments: [], curve_boxes: [], systems: [] } ], [])
    assert_empty metadata[:chord_diagrams]

    lyric_pages = [
      { systems: [ :tab ], texts: [ { x: 30, y: 500, text: "LYRICS & CHORDS" }, { x: 30, y: 490, text: "Cm" }, { x: 30, y: 480, text: "First line" } ] },
      { systems: [], texts: [ { x: 30, y: 700, text: "Second line" } ] }
    ]
    assert_equal "First line\nSecond line", recognizer.send(:lyrics, lyric_pages)
    assert_nil recognizer.send(:lyrics, [
      { systems: [], texts: [
        { x: 30, y: 700, text: "25" }, { x: 30, y: 690, text: "7" },
        { x: 30, y: 680, text: "0" }, { x: 30, y: 670, text: "7" }
      ] }
    ])

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
    labeled_start = recognizer.send(:systems, [ { x: 18, y: 643, text: "5" } ], horizontal + bars)
    assert_equal [ 20, 300, 580 ], labeled_start.first[:bars]
    uneven = [ 600, 610, 630, 640, 650 ].map { |y| [ 20, y, 580, y ] }
    assert_empty recognizer.send(:systems, [], uneven)
    narrow = [ [ 20, 600, 150, 600 ], [ 60, 610, 190, 610 ], [ 20, 620, 150, 620 ], [ 60, 630, 190, 630 ], [ 20, 640, 150, 640 ] ]
    assert_empty recognizer.send(:systems, [], narrow)
    short_horizontal = [ 600, 610, 620, 630, 640 ].map { |y| [ 20, y, 100, y ] }
    short_system = short_horizontal + [ [ 20, 600, 20, 640 ], [ 100, 600, 100, 640 ] ]
    short_result = recognizer.send(:systems, [ { x: 40, y: 636.4, text: "1" }, { x: 45.2, y: 636.4, text: "0" } ], short_system)
    assert_equal 1, short_result.length
    assert_equal [ 10 ], short_result.first[:events].flat_map { |event| event[:notes].map { |note| note[:fret] } }
    too_short = [ 600, 610, 620, 630, 640 ].map { |y| [ 20, y, 80, y ] }
    too_short[1] = [ 25, 610, 85, 610 ]
    assert_empty recognizer.send(:systems, [], too_short)
    assert_empty recognizer.send(:systems, [], horizontal)

    ghost_texts = [
      { x: 40, y: 636.4, text: "(" },
      { x: 42.6, y: 636.4, text: "3" },
      { x: 47, y: 636.4, text: ")" }
    ]
    ghost_result = recognizer.send(:systems, ghost_texts, horizontal + bars)
    assert ghost_result.first[:events].first[:notes].first[:ghost]
    assert recognizer.send(:parenthesized_note?, { x: 40, y: 636.4, text: "(3)" }, [])
    # Two-digit ghosts anchor the closing parenthesis to the last digit.
    two_digit_ghost_texts = [
      { x: 40, y: 636.4, text: "(" },
      { x: 42.6, y: 636.4, text: "1" },
      { x: 47, y: 636.4, text: "0" },
      { x: 51.4, y: 636.4, text: ")" }
    ]
    two_digit_ghost = recognizer.send(:systems, two_digit_ghost_texts, horizontal + bars)
    assert two_digit_ghost.first[:events].first[:notes].first[:ghost]
    assert recognizer.send(:parenthesized_note?, { x: 42.6, y: 636.4, text: "10", end_x: 47.0 }, [
      { x: 40, y: 636.4, text: "(" }, { x: 51.4, y: 636.4, text: ")" }
    ])

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

  test "collapses multi-stroke double barlines into one measure boundary" do
    recognizer = Tef2::PdfRecognizer.new
    # A thick-thin double barline prints as three close strokes: a thick line
    # (two strokes) plus a thin line. The cluster is wider than the 4pt
    # merge tolerance, so representative-based dedupe left the thin stroke
    # behind as a phantom sliver measure.
    horizontal = [ 600, 610, 620, 630, 640 ].map { |y| [ 20, y, 580, y ] }
    double_barline = [ [ 300, 600, 300, 640 ], [ 303.6, 600, 303.6, 640 ], [ 305.76, 600, 305.76, 640 ] ]
    bars = [ [ 20, 600, 20, 640 ] ] + double_barline + [ [ 580, 600, 580, 640 ] ]
    texts = [ { x: 40, y: 636.4, text: "1" }, { x: 400, y: 636.4, text: "2" } ]
    result = recognizer.send(:systems, texts, horizontal + bars)
    assert_equal [ 20, 300.0, 580 ], result.first[:bars]
    bars_list = result.first[:bars]
    per_bar = (1...bars_list.length).map do |bar|
      result.first[:events].select { |event| event[:x] >= bars_list[bar - 1] && event[:x] < bars_list[bar] }
        .flat_map { |event| event[:notes].map { |note| note[:fret] } }
    end
    assert_equal [ [ 1 ], [ 2 ] ], per_bar

    assert_equal [ 361.97, 470.0 ], recognizer.send(:chained_unique_sorted, [ 367.73, 361.97, 365.57, 470.0 ], 4.0)
    assert_equal [ 10.0, 60.0 ], recognizer.send(:chained_unique_sorted, [ 60.0, 10.0, 12.4 ], 4.0)
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
    receiver.show_text("$")
    receiver.show_text("%")
    assert_equal [ { x: 2, y: 3, text: "!" } ], receiver.flat_symbols
    assert_equal [ 33, 35, 36, 37 ], receiver.time_signature_symbols.map { |symbol| symbol[:code] }
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
      { x: 10, y: 10, code: 36, font: font },
      { x: 10, y: 20, code: 37, font: font }
    ])
    assert_equal({ numerator: 6, denominator: 8 }, receiver.time_signature)

    receiver.instance_variable_set(:@time_signature_symbols, [
      { x: 10, y: 10, code: 36, font: font },
      { x: 10, y: 20, code: 35, font: font }
    ])
    ttf.define_singleton_method(:find_glyph) { |_index| Struct.new(:x_min, :x_max).new(0, 300) }
    Zlib::Inflate.stub(:inflate, "ttf") do
      TTFunk::File.stub(:open, ->(*) { ttf }) do
        assert_equal({ numerator: 3, denominator: 8 }, receiver.time_signature)
      end
    end

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

  test "associates signature markers with their measure starts" do
    recognizer = Tef2::PdfRecognizer.new
    systems = [ { top: 100, bottom: 140, bars: [ 10, 100, 200 ] } ]
    markers = [
      { x: 12, y: 120, numerator: 3, denominator: 4 },
      { x: 102, y: 120, numerator: 6, denominator: 8 }
    ]

    recognizer.send(:assign_time_signature_markers, systems, markers)

    assert_equal({ 0 => { numerator: 3, denominator: 4 }, 1 => { numerator: 6, denominator: 8 } },
      systems.first[:time_signature_changes])
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

  def staff_page(title: nil, tuning: nil, extra_texts: [], note_texts: nil, flat_symbols_data: nil, extra_segments: [])
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
    segments.concat(extra_segments)
    FakePage.new(runs, segments, 612, 792, flat_symbols_data)
  end
end
