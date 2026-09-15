require "test_helper"
require "tef2/pdf_musicxml_builder"

class Tef2PdfMusicxmlBuilderTest < ActiveSupport::TestCase
  test "builds five string tab MusicXML with metadata, lyrics, techniques, and rests" do
    score = {
      title: "Builder demo",
      lyrics: "One line\nTwo lines",
      tuning_label: "gCGCD#",
      measures: 1,
      time_signature: { numerator: 3, denominator: 4 },
      tempo: 120,
      notes: [
        { measure: 0, position: 0, string: 0, fret: 0, dead: false },
        { measure: 0, position: 256, string: 0, fret: 2, dead: false },
        { measure: 0, position: 512, string: 1, fret: 3, dead: true },
        { measure: 0, position: 512, string: 2, fret: 5, dead: false }
      ],
      sections: [ { measure: 0, position: 0, text: "Verse" } ],
      chords: [ { measure: 0, position: 512, name: "C# min" }, { measure: 0, position: 768, name: "G7" }, { measure: 0, position: 896, name: "bad chord" } ],
      techniques: [
        { measure: 0, position: 0, string: 0, type: "hammer-on", label: "H" },
        { measure: 0, position: 512, string: 1, type: "thumb" }
      ],
      fingerings: [ { measure: 0, position: 512, string: 2, value: "2" } ]
    }

    xml = Tef2::PdfMusicxmlBuilder.build(score)
    document = Nokogiri::XML(xml)
    assert_equal "Builder demo", document.at_xpath("//work-title").text
    assert_equal "3", document.at_xpath("//time/beats").text
    assert_equal "gCGCD#", score[:tuning_label]
    assert_equal "120", document.at_xpath("//per-minute").text
    assert_equal "One line\nTwo lines", document.at_xpath("//miscellaneous-field[@name='playtab-lyrics']").text
    assert_equal 1, document.xpath("//measure").length
    assert_equal 2, document.xpath("//harmony").length
    assert_equal "2", document.xpath("//fingering").first.text
    assert_equal "TEF fingering T", document.at_xpath("//other-technical").text
    assert_equal "hammer-on", document.at_xpath("//hammer-on").name
    assert_equal "x", document.at_xpath("//notehead").text
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
    assert_equal [ 67, 50, 55, 59, 62 ], Tef2::PdfMusicxmlBuilder::DEFAULT_TUNING
  end

  test "uses the printed time signature when sizing an empty measure" do
    xml = Tef2::PdfMusicxmlBuilder.build(title: "Two Four", measures: 1, time_signature: { numerator: 2, denominator: 4 }, notes: [])
    document = Nokogiri::XML(xml)

    assert_equal "2", document.at_xpath("//time/beats").text
    assert_equal "4", document.at_xpath("//time/beat-type").text
    assert_equal "1920", document.at_xpath("//measure[1]/note/duration").text
    assert_equal "half", document.at_xpath("//measure[1]/note/type").text
  end
end
