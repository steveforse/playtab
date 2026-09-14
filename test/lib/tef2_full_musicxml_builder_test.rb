require "test_helper"

class Tef2FullMusicxmlBuilderTest < ActiveSupport::TestCase
  test "emits MusicXML element names and pitches alphaTab can import" do
    parsed = {
      measures: 1,
      notes: [
        {
          index: 0,
          component_index: 0,
          measure: 0,
          position: 0,
          string: 2,
          fret: 0,
          technique: 0,
          tef2_duration: 256,
          is_chord: false,
          voice: 2
        }
      ],
    annotations: { 0 => 6 },
      texts: [ { measure: 0, position: 64, text: "Verse" } ],
      lyrics_text: "LYRICS & CHORDS\n\nVERSE\nCm\nThere once was a ship",
      chords: [ { measure: 0, position: 64, name: "C min", strings: [ 0, 0, 0, 0, -1 ], first_fret: 1 } ],
      time_signature: { numerator: 4, denominator: 4 },
      tempo: 120,
      strings: 5,
      tuning: [ 63, 60, 55, 48, 67 ]
    }

    document = Nokogiri::XML(Tef2::FullMusicxmlBuilder.build(parsed))

    assert_empty document.xpath("//*[contains(name(), '_')]")
    assert_equal "P1", document.at_xpath("//part-list/score-part")["id"]
    assert_equal "2", document.at_xpath("//part/measure/attributes/staves").text
    assert_equal "yes", document.at_xpath("//staff-details")["print-object"]
    assert_equal "E", document.at_xpath("//staff-details/staff-tuning[last()]/tuning-step").text
    assert_equal "-1", document.at_xpath("//staff-details/staff-tuning[last()]/tuning-alter").text
    assert_equal "120", document.at_xpath("//direction/direction-type/metronome/per-minute").text
    assert_equal "Verse", document.at_xpath("//direction/direction-type/words").text
    assert_equal [ "240", "240" ], document.xpath("//direction/offset").map(&:text)
    assert_equal 2, document.xpath("//harmony").length
    assert_equal [ "240", "240" ], document.xpath("//harmony/offset").map(&:text)
    assert_equal "C", document.at_xpath("//harmony/root/root-step").text
    assert_equal " min", document.at_xpath("//harmony/kind")[:text]
    assert_equal "TEF fingering code 6", document.at_xpath("//other-technical").text
    assert_equal 2, document.xpath("//note[voice='2']").length
    assert_includes document.at_xpath("//miscellaneous-field[@name='playtab-lyrics']").text, "There once was a ship"
    assert_empty document.xpath("//lyric")
    assert_empty document.xpath("//harmony/frame")
    assert_empty document.xpath("//harmony[@print-frame]")

    note_pitch = document.at_xpath("//part/measure/note/pitch")
    assert_equal "G", note_pitch.at_xpath("step").text
    assert_equal "3", note_pitch.at_xpath("octave").text
    assert_equal "0", note_pitch.at_xpath("alter").text
  end
end
