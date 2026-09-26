require "test_helper"

class Tef2ReadingListTest < ActiveSupport::TestCase
  test "decodes repeats, endings and jumps that play in the reading-list order" do
    {
      "plain repeat played three times" => [ [ [ 1, 4 ], [ 1, 4 ], [ 1, 4 ], [ 5, 8 ] ], 8 ],
      "first and second endings" => [ [ [ 1, 8 ], [ 1, 7 ], [ 9, 17 ], [ 10, 16 ], [ 18, 18 ] ], 18 ],
      "two-measure endings" => [ [ [ 1, 11 ], [ 2, 9 ], [ 12, 14 ] ], 14 ],
      "a repeat right after the first ending" => [ [ [ 1, 4 ], [ 1, 3 ], [ 5, 8 ], [ 5, 8 ] ], 8 ],
      "D.C. al Coda" => [ [ [ 1, 32 ], [ 1, 15 ], [ 33, 33 ] ], 33 ],
      "D.S. al Coda" => [ [ [ 1, 26 ], [ 2, 8 ], [ 27, 27 ] ], 27 ],
      "D.C. al Fine" => [ [ [ 1, 12 ], [ 1, 6 ] ], 12 ]
    }.each do |name, (list, measures)|
      bars, warnings = Tef2::ReadingList.decode(list, measures)
      expected = list.flat_map { |from, to| ((from - 1)..(to - 1)).to_a }
      assert_equal expected, Tef2::ReadingList.playback_order(bars), name
      assert_empty warnings, name
      assert_equal list.flat_map { |from, to| (from..to).to_a }, Tef2::ReadingList.sequences(Tef2::ReadingList.playback_order(bars)).flat_map { |from, to| (from..to).to_a }, name
    end

    bars, = Tef2::ReadingList.decode([ [ 1, 8 ], [ 1, 7 ], [ 9, 10 ] ], 10)
    assert_equal [ true, 2, [ 1 ] ], [ bars[0][:forward], bars[7][:backward], bars[7][:endings] ]
    assert_equal [ 2 ], bars[8][:endings]
    coda, = Tef2::ReadingList.decode([ [ 1, 26 ], [ 2, 8 ], [ 27, 27 ] ], 27)
    assert_equal [ 1, 7, 25, 26 ], [ :segno, :to_coda, :dalsegno, :coda ].map { |mark| coda.index { |bar| bar[mark] } }
  end

  test "warns about reading lists it cannot play as written" do
    assert_equal [ nil, [] ], Tef2::ReadingList.decode([], 4)
    bars, warnings = Tef2::ReadingList.decode([ [ 1, 9 ] ], 4)
    assert_nil bars
    assert_match(/outside the score/, warnings.first)

    _, warnings = Tef2::ReadingList.decode([ [ 1, 16 ], [ 9, 16 ] ], 21)
    assert_equal [ "The TablEdit reading list ends at measure 16; the score plays the remaining measures." ], warnings
    _, warnings = Tef2::ReadingList.decode([ [ 1, 4 ], [ 7, 8 ] ], 8)
    assert_match(/skips from measure 4 to 7/, warnings.first)
    _, warnings = Tef2::ReadingList.decode([ [ 1, 30 ], [ 1, 10 ], [ 31, 40 ], [ 5, 40 ] ], 40)
    assert_match(/only the first D.C.\/D.S./, warnings.first)
    _, warnings = Tef2::ReadingList.decode([ [ 1, 9 ], [ 2, 6 ], [ 10, 44 ], [ 2, 9 ], [ 2, 6 ], [ 10, 27 ], [ 45, 45 ] ], 45)
    assert_match(/repeats play once/, warnings.first)
    # A repeat nested in a repeat has no plain MusicXML form here.
    _, warnings = Tef2::ReadingList.decode([ [ 1, 2 ], [ 1, 4 ], [ 1, 2 ], [ 1, 4 ] ], 4)
    assert_match(/repeats play once/, warnings.first)
    assert_equal [], Tef2::ReadingList.sequences((0..5).to_a)
  end

  test "round trips a TEF3 reading list through MusicXML and export" do
    list = [ [ 1, 4 ], [ 1, 3 ], [ 5, 8 ], [ 5, 8 ] ]
    bytes = tef3_with_reading_list(list, 8)
    parsed = Tef2::TableditV3Parser.parse(bytes)
    assert_equal list, parsed[:reading_list]

    musicxml = Tef2.convert(bytes)[:musicxml]
    document = Nokogiri::XML(musicxml)
    assert_equal %w[forward backward forward backward], document.xpath("//repeat").map { |repeat| repeat["direction"] }
    assert_equal [ %w[1 start], %w[1 stop] ], document.xpath("//ending").map { |ending| [ ending["number"], ending["type"] ] }

    result = Tef2::Exporter.export({ "version" => 2, "title" => "Reading", "source" => musicxml }, version: "tef3")
    assert_equal [ [ 1, 4 ], [ 1, 3 ], [ 5, 8 ], [ 5, 8 ] ], Tef2::TableditV3Parser.parse(result[:bytes])[:reading_list]
    refute result[:warnings].any? { |warning| warning.include?("repeat") }
    tef2 = Tef2::Exporter.export({ "version" => 2, "title" => "Reading", "source" => musicxml }, version: "tef2")
    assert_includes tef2[:warnings], "TEF2 export writes the measures in written order; repeats, endings and jumps are not represented."

    coda = Tef2.convert(tef3_with_reading_list([ [ 1, 8 ], [ 2, 3 ], [ 9, 9 ] ], 9))
    document = Nokogiri::XML(coda[:musicxml])
    assert_equal 1, document.xpath("//measure[2]/direction/direction-type/segno").length
    assert_equal [ "coda" ], document.xpath("//measure[3]/sound/@tocoda").map(&:value)
    assert_equal [ "segno" ], document.xpath("//measure[8]/sound/@dalsegno").map(&:value)
    exported = Tef2::Exporter.export({ "version" => 2, "title" => "Coda", "source" => coda[:musicxml] }, version: "tef3")
    assert_equal [ [ 1, 8 ], [ 2, 3 ], [ 9, 9 ] ], Tef2::TableditV3Parser.parse(exported[:bytes])[:reading_list]
    assert_empty Tef2::TableditV3Parser.parse(exported[:bytes])[:texts]
  end

  test "rejects malformed reading lists" do
    bytes = tef3_with_reading_list([ [ 1, 2 ] ], 2).bytes
    pointer = bytes[0x80, 4].pack("C*").unpack1("V")
    bytes[pointer] = 2
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse(bytes) }
    bytes[pointer] = 32
    bytes[pointer + 2] = 3
    assert_raises(Tef2::TableditV3Parser::Invalid) { Tef2::TableditV3Parser.parse(bytes) }
  end

  private

  def tef3_with_reading_list(list, measures)
    notes = measures.times.map do |measure|
      { measure: measure, position: 0, duration: 1024, string: 2, fret: measure % 12, effect1: 0, effect2: 0, effect3: 0, tie: false, grace: false }
    end
    model = Tef2::Exporter::Model.new(
      title: "Reading", tempo: 120, tuning: [ 62, 59, 55, 50, 67 ], measures: Array.new(measures) { { numerator: 4, denominator: 4 } },
      notes: notes, texts: [], chords: [], lyrics: nil, warnings: [], reading_list: list
    )
    Tef2::Exporter::TableditWriter.build(model)
  end
end
