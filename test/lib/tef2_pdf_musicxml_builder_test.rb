require "test_helper"
require "tef2/pdf_musicxml_builder"

class Tef2PdfMusicxmlBuilderTest < ActiveSupport::TestCase
  test "builds five string tab MusicXML with metadata, lyrics, techniques, and rests" do
    score = {
      title: "Builder demo",
      lyrics: "One line\nTwo lines",
      subtitle: "gCGCD# (capo 2), Brainjo level 3",
      arranger: "arranged by Josh Turknett CLAWHAMMERBANJO.NET",
      tuning_label: "gCGCD#",
      measures: 1,
      time_signature: { numerator: 3, denominator: 4 },
      tempo: 120,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0, dead: false },
        { measure: 0, position: 256, string: 0, fret: 2, dead: false, ghost: true },
        { measure: 0, position: 512, string: 1, fret: 3, dead: true },
        { measure: 0, position: 512, string: 2, fret: 5, dead: false }
      ],
      sections: [ { measure: 0, position: 0, text: "Verse" } ],
      chords: [ { measure: 0, position: 512, name: "C# min" }, { measure: 0, position: 768, name: "G7" }, { measure: 0, position: 896, name: "bad chord" } ],
      chord_diagrams: [ { name: "C# min", strings: [ 0, 2, 0, 1, 0 ], first_fret: 1 } ],
      repeats: [ { measure: 0, location: "left", direction: "forward" }, { measure: 0, location: "right", direction: "backward" } ],
      techniques: [
        { measure: 0, position: 0, string: 0, type: "hammer-on", label: "H" },
        { measure: 0, position: 512, string: 1, type: "thumb" }
      ],
      fingerings: [ { measure: 0, position: 512, string: 2, value: "2" }, { measure: 0, position: 0, string: 0, value: "I" } ],
      strums: [ { measure: 0, position: 0, string: 0, direction: "up" } ]
    }

    xml = Tef2::PdfMusicxmlBuilder.build(score)
    document = Nokogiri::XML(xml)
    assert_equal "Builder demo", document.at_xpath("//work-title").text
    assert_equal "3", document.at_xpath("//time/beats").text
    assert_equal "gCGCD#", score[:tuning_label]
    assert_equal "120", document.at_xpath("//per-minute").text
    assert_equal "One line\nTwo lines", document.at_xpath("//miscellaneous-field[@name='playtab-lyrics']").text
    assert_equal "gCGCD# (capo 2), Brainjo level 3", document.at_xpath("//credit[credit-type='subtitle']/credit-words").text
    assert_equal "arranged by Josh Turknett CLAWHAMMERBANJO.NET", document.at_xpath("//credit[credit-type='arranger']/credit-words").text
    assert_equal 1, document.xpath("//measure").length
    assert_equal 2, document.xpath("//harmony").length
    assert_equal "dominant", document.at_xpath("//harmony[root/root-step='G']/kind").text
    assert_equal "0,2,0,1,0", document.at_xpath("//harmony[root/root-step='C'][root/root-alter='1']")["data-playtab-strings"]
    assert_equal 2, document.xpath("//barline/repeat").length
    assert_equal "2", document.xpath("//fingering").first.text
    assert_equal "TEF fingering T", document.xpath("//other-technical").find { |item| item.text == "TEF fingering T" }.text
    assert_equal "TEF fingering I", document.xpath("//other-technical").find { |item| item.text == "TEF fingering I" }.text
    assert_equal "TEF strum up", document.xpath("//other-technical").find { |item| item.text == "TEF strum up" }.text
    assert_equal "hammer-on", document.at_xpath("//hammer-on").name
    assert_equal "x", document.at_xpath("//notehead[text()='x']").text
    assert_equal 1, document.xpath("//notehead[@parentheses='yes']").length
    assert_equal 4, document.xpath("//note").length
  end

  test "uses default tuning and helper grids for empty scores" do
    xml = Tef2::PdfMusicxmlBuilder.build(title: "Empty", measures: 2, notes: [])
    document = Nokogiri::XML(xml)
    assert_equal 2, document.xpath("//measure").length
    assert_equal 5, document.xpath("//staff-tuning").length
    assert_equal "whole", document.at_xpath("//measure[1]//type").text
    assert_equal "C", Tef2::PdfMusicxmlBuilder.new.send(:midi_pitch, 60).first
    assert_equal "eighth", Tef2::PdfMusicxmlBuilder.new.send(:duration_type, 100)
    assert_equal "quarter", Tef2::PdfMusicxmlBuilder.new.send(:duration_type, 1440)
    assert_equal [ 67, 50, 55, 59, 62 ], Tef2::PdfMusicxmlBuilder::DEFAULT_TUNING
  end

  test "writes stacked fingerings as separate technical annotations" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Stacked fingering",
      measures: 1,
      notes: [ { measure: 0, position: 0, string: 0, fret: 0 } ],
      fingerings: [
        { measure: 0, position: 0, string: 0, value: "M" },
        { measure: 0, position: 0, string: 0, value: "I" }
      ]
    )
    document = Nokogiri::XML(xml)

    assert_equal [ "TEF fingering M", "TEF fingering I" ],
      document.xpath("//measure[1]/note//other-technical").map(&:text)
  end

  test "writes tuplet timing metadata on inferred silent triplet slots" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Silent triplet",
      measures: 1,
      notes: [ { measure: 0, position: 768, string: 0, fret: 0, tuplet: true } ],
      rests: [ { measure: 0, position: 853, tuplet: true }, { measure: 0, position: 939, tuplet: true } ]
    )
    document = Nokogiri::XML(xml)
    assert_equal 2, document.xpath("//note[rest]/time-modification").length
    assert_equal 1, document.xpath("//note[not(rest)]/time-modification").length
    assert_equal 960, document.xpath("//measure[1]/note[time-modification]/duration").sum { |duration| duration.text.to_i }
  end

  test "uses banjo string octaves and visual staff rows for PDF pitches" do
    builder = Tef2::PdfMusicxmlBuilder.new
    assert_equal [ 67, 50, 55, 59, 62 ], builder.send(:parse_tuning, "gDGBD")
    assert_equal [ 67, 48, 55, 59, 62 ], builder.send(:parse_tuning, "gCGBD")
    assert_equal [ 69, 50, 57, 62, 64 ], builder.send(:parse_tuning, "aDADE")
    assert_equal [ 67, 55, 55, 62, 60 ], builder.send(:parse_tuning, "gGGDC")

    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Tuning rows",
      tuning_label: "gCGBD",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0 },
        { measure: 0, position: 256, string: 1, fret: 0 },
        { measure: 0, position: 512, string: 3, fret: 0 }
      ]
    )
    document = Nokogiri::XML(xml)
    assert_equal [ "G", "C", "G", "B", "D" ], document.xpath("//staff-tuning/tuning-step").map(&:text)
    assert_equal [ "4", "3", "3", "3", "4" ], document.xpath("//staff-tuning/tuning-octave").map(&:text)
    notes = document.xpath("//measure[1]/note[not(rest)]")
    assert_equal [ [ "D", "4" ], [ "B", "3" ], [ "C", "3" ] ], notes.map { |note| [ note.at_xpath("./pitch/step").text, note.at_xpath("./pitch/octave").text ] }
  end

  test "attaches a technique to the matching fret when notes share a position and string" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Shared position",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0 },
        { measure: 0, position: 0, string: 0, fret: 2 },
        { measure: 0, position: 256, string: 0, fret: 2 }
      ],
      techniques: [ { measure: 0, position: 0, string: 0, type: "hammer-on", label: "H" } ]
    )
    document = Nokogiri::XML(xml)

    assert_equal 1, document.xpath("//hammer-on[@type='start']").length
    assert_equal 1, document.xpath("//hammer-on[@type='stop']").length
    assert_equal "0", document.at_xpath("//hammer-on[@type='start']/ancestor::note/notations/technical/fret").text
  end

  test "collapses duplicate same-kind technique marks on one note into a single span" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Duplicate hammer marks",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0 },
        { measure: 0, position: 256, string: 0, fret: 2 }
      ],
      techniques: [
        { measure: 0, position: 0, string: 0, type: "hammer-on", label: "H" },
        { measure: 0, position: 0, string: 0, type: "hammer-on", label: "h" }
      ]
    )
    document = Nokogiri::XML(xml)

    assert_equal 1, document.xpath("//hammer-on[@type='start']").length
    assert_equal 1, document.xpath("//hammer-on[@type='stop']").length
  end

  test "preserves a technique stop and start on the same note" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Chained techniques",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0 },
        { measure: 0, position: 256, string: 0, fret: 3 },
        { measure: 0, position: 512, string: 0, fret: 0 }
      ],
      techniques: [
        { measure: 0, position: 0, string: 0, type: "hammer-on", label: "H" },
        { measure: 0, position: 256, string: 0, type: "pull-off", label: "Po" }
      ]
    )
    document = Nokogiri::XML(xml)
    chained_note = document.at_xpath("//measure[1]/note[2]")
    chained_destination = document.at_xpath("//measure[1]/note[3]")

    assert_equal "stop", chained_note.at_xpath("./notations/technical/hammer-on")["type"]
    assert_equal "start", chained_note.at_xpath("./notations/technical/pull-off")["type"]
    assert_equal "stop", chained_destination.at_xpath("./notations/technical/pull-off")["type"]
  end

  test "writes a PDF rake as an arpeggio with an R annotation" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Rake",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 5 },
        { measure: 0, position: 0, string: 1, fret: 0 },
        { measure: 0, position: 0, string: 2, fret: 0 }
      ],
      techniques: [ { measure: 0, position: 0, string: 0, type: "rake", label: "R" } ]
    )
    document = Nokogiri::XML(xml)

    assert_equal 1, document.xpath("//arpeggiate[@direction='down']").length
    assert_equal "TEF rake", document.at_xpath("//other-technical").text
  end

  test "writes a PDF upward strum marker on the selected note" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Strum",
      measures: 1,
      notes: [ { measure: 0, position: 0, string: 0, fret: 0 } ],
      strums: [ { measure: 0, position: 0, string: 0, direction: "up" } ]
    )
    document = Nokogiri::XML(xml)

    assert_equal "TEF strum up", document.at_xpath("//other-technical").text
  end

  test "writes a PDF slide as a native span with its printed label" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Slide",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 1, fret: 2 },
        { measure: 0, position: 256, string: 1, fret: 4 }
      ],
      techniques: [ { measure: 0, position: 0, string: 1, type: "slide", label: "Sl" } ]
    )
    document = Nokogiri::XML(xml)

    assert_equal 1, document.xpath("//measure[1]/note[1]/notations/slide[@type='start']").length
    assert_equal "Sl", document.at_xpath("//measure[1]/note[1]/notations/slide").text
    assert_equal "TEF slide Sl", document.at_xpath("//measure[1]/note[1]/notations/technical/other-technical").text
    assert_empty document.xpath("//measure[1]/note[1]/notations/technical/slide")
  end

  test "writes a standalone PDF slide-in marker without a native span" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Slide in",
      measures: 1,
      notes: [ { measure: 0, position: 0, string: 1, fret: 2 } ],
      techniques: [ { measure: 0, position: 0, string: 1, type: "slide-in", label: "/" } ]
    )
    document = Nokogiri::XML(xml)

    assert_equal "TEF slide /", document.at_xpath("//measure[1]/note[1]/notations/technical/other-technical").text
    assert_empty document.xpath("//measure[1]/note[1]/notations/slide")
  end

  test "writes a scanned slide-in grace note before its destination" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Grace slide",
      measures: 1,
      notes: [ { measure: 0, position: 448, string: 0, fret: 4, grace_note_fret: 3 } ],
      techniques: [ { measure: 0, position: 448, string: 0, type: "slide-in", label: "/" } ]
    )
    document = Nokogiri::XML(xml)
    notes = document.xpath("//measure[1]/note[not(rest)]")

    assert_equal 2, notes.length
    assert_equal "yes", notes.first.at_xpath("./grace")["slash"]
    assert_equal "1", notes.first.at_xpath("./notations/technical/string").text
    assert_equal "3", notes.first.at_xpath("./notations/technical/fret").text
    assert_equal "4", notes[1].at_xpath("./notations/technical/fret").text
    assert_equal "TEF slide /", notes[1].at_xpath("./notations/technical/other-technical").text
  end

  test "writes a scanned grace pull-off on both ends of its slur" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Grace pull-off",
      measures: 1,
      notes: [ { measure: 0, position: 256, string: 2, fret: 2, grace_note_fret: 4, grace_note_technique: "pull-off" } ],
      techniques: []
    )
    document = Nokogiri::XML(xml)
    notes = document.xpath("//measure[1]/note[not(rest)]")

    assert_equal 2, notes.length
    assert_equal "4", notes.first.at_xpath("./notations/technical/fret").text
    assert_equal "start", notes.first.at_xpath("./notations/technical/pull-off")["type"]
    assert_equal "2", notes.last.at_xpath("./notations/technical/fret").text
    assert_equal "stop", notes.last.at_xpath("./notations/technical/pull-off")["type"]
  end

  test "writes PDF ties on both ends of each tied note" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Tie",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 1, fret: 0 },
        { measure: 0, position: 256, string: 1, fret: 0 }
      ],
      ties: [
        { measure: 0, position: 0, string: 1, type: "start" },
        { measure: 0, position: 256, string: 1, type: "stop" }
      ]
    )
    document = Nokogiri::XML(xml)

    assert_equal 1, document.xpath("//measure[1]/note[1]/notations/tied[@type='start']").length
    assert_equal 1, document.xpath("//measure[1]/note[2]/notations/tied[@type='stop']").length
  end

  test "drops a self tie before writing MusicXML" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Self tie",
      measures: 1,
      notes: [ { measure: 0, position: 0, string: 1, fret: 0 } ],
      ties: [
        { measure: 0, position: 0, string: 1, type: "start" },
        { measure: 0, position: 0, string: 1, type: "stop" }
      ]
    )
    document = Nokogiri::XML(xml)

    assert_empty document.xpath("//measure[1]/note/notations/tied")
  end

  test "writes a native PDF capo effect when the recognizer supplies one" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Capo",
      capo: 2,
      measures: 1,
      notes: [ { measure: 0, position: 0, string: 1, fret: 0 } ]
    )
    document = Nokogiri::XML(xml)

    assert_equal [ "2" ], document.xpath("//measure[1]/attributes/staff-details/capo").map(&:text)
    assert_empty document.xpath("//measure[1]/direction/direction-type/words")
  end

  test "does not pair a technique with a distant note" do
    notes = [
      { measure: 0, position: 0, string: 0, fret: 0 },
      { measure: 4, position: 0, string: 0, fret: 2 }
    ]
    score = { techniques: [ { measure: 0, position: 0, string: 0, type: "hammer-on" } ] }

    assert_empty Tef2::PdfMusicxmlBuilder.new.send(:techniques_by_note, score, notes)
  end

  test "uses the printed time signature when sizing an empty measure" do
    xml = Tef2::PdfMusicxmlBuilder.build(title: "Two Four", measures: 1, time_signature: { numerator: 2, denominator: 4 }, notes: [])
    document = Nokogiri::XML(xml)

    assert_equal "2", document.at_xpath("//time/beats").text
    assert_equal "4", document.at_xpath("//time/beat-type").text
    assert_equal "1920", document.at_xpath("//measure[1]/note/duration").text
    assert_equal "half", document.at_xpath("//measure[1]/note/type").text
  end

  test "writes time-signature changes and measure-specific durations" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Mixed meter",
      measures: 3,
      time_signature: { numerator: 3, denominator: 4 },
      measure_signatures: [
        { numerator: 3, denominator: 4 },
        { numerator: 6, denominator: 8 },
        { numerator: 3, denominator: 8 }
      ],
      notes: []
    )
    document = Nokogiri::XML(xml)

    assert_equal [ "3", "6", "3" ], document.xpath("//measure/attributes/time/beats").map(&:text)
    assert_equal [ "4", "8", "8" ], document.xpath("//measure/attributes/time/beat-type").map(&:text)
    assert_equal [ "2880", "2880", "1440" ], document.xpath("//measure/note/duration").map(&:text)
  end

  test "writes dotted durations and first and second endings" do
    dotted = Tef2::PdfMusicxmlBuilder.build(
      title: "Dotted",
      measures: 1,
      time_signature: { numerator: 2, denominator: 4 },
      notes: [ { measure: 0, position: 384, string: 0, fret: 0 } ]
    )
    dotted_document = Nokogiri::XML(dotted)
    rest = dotted_document.at_xpath("//measure[1]/note[rest]")
    assert_equal "1440", rest.at_xpath("./duration").text
    assert_equal "quarter", rest.at_xpath("./type").text
    assert_equal 1, rest.xpath("./dot").length

    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Endings",
      measures: 2,
      notes: [],
      endings: [
        { measure: 0, location: "left", number: "1", type: "start" },
        { measure: 1, location: "left", number: "2", type: "start" }
      ]
    )
    document = Nokogiri::XML(xml)
    assert_equal "start", document.at_xpath("//measure[1]/barline[@location='left']/ending")["type"]
    assert_equal "1", document.at_xpath("//measure[1]/barline[@location='right']/ending")["number"]
    assert_equal "2", document.at_xpath("//measure[2]/barline[@location='left']/ending")["number"]
    assert_equal "stop", document.at_xpath("//measure[2]/barline[@location='right']/ending")["type"]
  end

  test "writes PDF triplet timing and MusicXML time modification" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Triplet",
      measures: 1,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0 },
        { measure: 0, position: 256, string: 0, fret: 1, tuplet: true },
        { measure: 0, position: 341, string: 1, fret: 2, tuplet: true },
        { measure: 0, position: 427, string: 2, fret: 3, tuplet: true },
        { measure: 0, position: 512, string: 0, fret: 2 },
        { measure: 0, position: 768, string: 0, fret: 0 }
      ]
    )
    document = Nokogiri::XML(xml)
    notes = document.xpath("//measure[1]/note[not(rest)]")

    assert_equal [ "960", "319", "322", "319", "960", "960" ], notes.map { |note| note.at_xpath("./duration").text }
    assert_equal [ "eighth", "eighth", "eighth" ], notes[1, 3].map { |note| note.at_xpath("./type").text }
    assert_equal 3, document.xpath("//measure[1]/note/time-modification").length
    assert_equal [ "3", "2" ], document.xpath("//measure[1]/note[2]/time-modification/*").map(&:text)
  end

  test "writes explicit PDF silence stems as rests at their positions" do
    xml = Tef2::PdfMusicxmlBuilder.build(
      title: "Silence stems",
      measures: 1,
      time_signature: { numerator: 4, denominator: 4 },
      notes: [ { measure: 0, position: 0, string: 0, fret: 0 }, { measure: 0, position: 512, string: 0, fret: 2 } ],
      rests: [ { measure: 0, position: 256 } ]
    )
    document = Nokogiri::XML(xml)
    notes = document.xpath("//measure[1]/note")

    assert_equal [ "960", "960", "1920" ], notes.map { |note| note.at_xpath("./duration").text }
    assert_equal 1, document.xpath("//measure[1]/note/rest").length
    assert_equal "0", notes.first.at_xpath("./notations/technical/fret").text
  end

  test "maps common chord suffixes to MusicXML harmony kinds" do
    builder = Tef2::PdfMusicxmlBuilder.new
    expected = {
      "" => "major", "maj" => "major", "major" => "major", "m" => "minor", "min" => "minor", "minor" => "minor",
      "7" => "dominant", "maj7" => "major-seventh", "m7" => "minor-seventh", "min7" => "minor-seventh",
      "dim" => "diminished", "dim7" => "diminished-seventh", "aug" => "augmented", "aug7" => "augmented-seventh",
      "sus2" => "suspended-second", "sus" => "suspended-fourth", "sus4" => "suspended-fourth", "add9" => "other"
    }

    expected.each { |suffix, kind| assert_equal kind, builder.send(:chord_kind, suffix) }
  end
end
