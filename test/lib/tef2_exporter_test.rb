require "test_helper"

class Tef2ExporterTest < ActiveSupport::TestCase
  test "round trips imported metadata and techniques through TEF2" do
    result = Tef2::Exporter.export(imported_document, version: "tef2")
    parsed = Tef2::FullParser.parse(result[:bytes])

    assert_equal "Imported", result[:bytes].byteslice(0, 8).delete("\0")
    assert_equal 3, result[:bytes].getbyte(205)
    assert_equal 480, result[:bytes].byteslice(226, 2).unpack1("v")
    assert_equal 2, result[:bytes].byteslice(230, 2).unpack1("v")
    assert_equal 1, result[:bytes].getbyte(239)
    assert_equal 632, result[:bytes].byteslice(246, 2).unpack1("v")
    assert_equal 163, result[:bytes].getbyte(249)
    assert_equal [ "Verse" ], parsed[:texts].map { |text| text[:text] }
    assert_equal [ "G" ], parsed[:chords].map { |chord| chord[:name] }
    assert_includes parsed[:lyrics_text], "LYRICS & CHORDS"
    assert_includes parsed[:lyrics_text], "Row one"
    assert_equal [ 1, 2, 3, 4 ], parsed[:notes].map { |note| note[:effect1] }
    assert_equal [ 2, 3, 6, 5 ], parsed[:notes].map { |note| note[:annotation] }
  end

  test "round trips TEF3 tuplets, grace notes, ties and thumb fingering" do
    model = Tef2::Exporter::Model.new(
      title: "Tuplets", tempo: 120, tuning: [ 62, 59, 55, 50, 67 ],
      measures: [ { numerator: 3, denominator: 4 }, { numerator: 4, denominator: 4 } ],
      notes: [ { measure: 1, position: 0, duration: 256, string: 0, fret: 4, effect1: 1, effect2: 0, effect3: 0, annotation: 6, fingering: "T", tie: true, tuplet: true, grace: true } ],
      texts: [], chords: [], lyrics: nil, warnings: []
    )
    result = Tef2::Exporter.export({ "version" => 1, "title" => "x", "tempo" => 120, "tuning" => [ 62, 59, 55, 50, 67 ], "measures" => [ { "beats" => Array.new(4) { { "duration" => 4, "notes" => [ { "string" => 1, "fret" => 0 } ] } } } ] }, version: "tef3")
    parsed = Tef2::TableditV3Parser.parse(result[:bytes])
    assert_equal false, parsed[:notes].first[:tuplet]

    bytes = Tef2::Exporter::TableditWriter.build(model)
    note = Tef2::TableditV3Parser.parse(bytes)[:notes].first
    assert_equal [ "T" ], note[:fingerings]
    assert note[:grace]
    assert note[:tie]
    assert note[:tuplet]
  end

  test "reports malformed documents and TEF2 limits" do
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.from(nil) }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.from_native({ "version" => 2 }) }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.from_native({ "version" => 1, "measures" => [] }) }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.from_native({ "version" => 1, "measures" => [ { "beats" => [] } ] }) }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter.export({ "version" => 2, "source" => "<score-partwise>" }, version: "tef2") }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter.export(native_document.merge("version" => "bad"), version: "tef2") }

    base = { title: "x", tempo: 120, measures: [ { numerator: 4, denominator: 4 } ], notes: [], texts: [], chords: [], lyrics: nil, warnings: [] }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.new(**base, tuning: [ 1 ]) }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.new(**base, tuning: [ 300, 59, 55, 50, 67 ]) }
    bad_note = { measure: 0, position: 0, duration: 256, string: 5, fret: 0 }
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.new(**base, tuning: [ 62, 59, 55, 50, 67 ], notes: [ bad_note ]) }
    bad_fret = bad_note.merge(string: 0, fret: 50)
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.new(**base, tuning: [ 62, 59, 55, 50, 67 ], notes: [ bad_fret ]) }
    bad_measure = bad_note.merge(string: 0, measure: 1)
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::Model.new(**base, tuning: [ 62, 59, 55, 50, 67 ], notes: [ bad_measure ]) }

    non_four_model = Tef2::Exporter::Model.new(**base, tuning: [ 62, 59, 55, 50, 67 ], measures: [ { numerator: 3, denominator: 4 } ], notes: [ bad_note.merge(string: 0) ])
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter::LegacyWriter.build(non_four_model) }
    high_fret = imported_document.merge("source" => imported_document["source"].sub("<fret>1</fret>", "<fret>30</fret>"))
    assert_raises(Tef2::Exporter::Invalid) { Tef2::Exporter.export(high_fret, version: "tef2") }
  end

  private

  def native_document
    {
      "version" => 1, "title" => "Native", "tempo" => 120, "tuning" => [ 62, 59, 55, 50, 67 ],
      "measures" => [ { "beats" => [
        { "duration" => 4, "notes" => [ { "string" => 1, "fret" => 0 } ] },
        { "duration" => 4, "notes" => [] }, { "duration" => 4, "notes" => [] }, { "duration" => 4, "notes" => [] }
      ] } ]
    }
  end

  def imported_document
    {
      "version" => 2, "kind" => "musicxml", "title" => "Imported", "sourceName" => "import.musicxml", "sourceFormat" => "musicxml", "warnings" => [],
      "source" => <<~XML
        <score-partwise><identification><miscellaneous><miscellaneous-field name="playtab-lyrics">LYRICS &amp; CHORDS
        Row one</miscellaneous-field></miscellaneous></identification><part><measure number="1"><attributes><divisions>256</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staff-details number="2"><staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="4"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="5"><tuning-step>D</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details></attributes><direction><direction-type><words>Verse</words></direction-type></direction><forward><duration>64</duration></forward><harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>#{technique_note(1, "hammer-on") }#{technique_note(2, "pull-off")}#{technique_note(3, "slide")}#{technique_note(4, "bend")}</measure></part></score-partwise>
      XML
    }
  end

  def technique_note(fret, technique)
    thumb = technique == "slide" ? "<other-technical>TEF fingering T</other-technical>" : ""
    "<note><pitch><step>D</step><octave>4</octave></pitch><duration>64</duration><staff>2</staff><notations><technical><string>1</string><fret>#{fret}</fret><fingering>#{fret}</fingering>#{thumb}<#{technique} type=\"start\"><bend-alter>0.5</bend-alter></#{technique}></technical></notations></note>"
  end
end
