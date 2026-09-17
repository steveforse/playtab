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
      texts: [ { measure: 0, position: 64, string: 3, text: "Verse" } ],
      lyrics_text: "LYRICS & CHORDS\n\nVERSE\nCm\nThere once was a ship",
      chords: [ { measure: 0, position: 64, string: 2, name: "C min", strings: [ 0, 0, 0, 0, -1 ], first_fret: 1 } ],
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
    assert_equal [ "3", "3" ], document.xpath("//direction/@data-playtab-string").map(&:value)
    assert_equal 2, document.xpath("//harmony").length
    assert_equal [ "240", "240" ], document.xpath("//harmony/offset").map(&:text)
    assert_equal [ "2", "2" ], document.xpath("//harmony/@data-playtab-string").map(&:value)
    assert_equal [ "0,0,0,0,-1", "0,0,0,0,-1" ], document.xpath("//harmony/@data-playtab-strings").map(&:value)
    assert_equal [ "1", "1" ], document.xpath("//harmony/@data-playtab-first-fret").map(&:value)
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

  test "uses fret direction for modern legato markers" do
    notes = [
      { component_index: 0, measure: 0, position: 0, absolute_position: 0, string: 2, fret: 0, effect1: 2, effect3: 0, effect2: 0, tef2_duration: 64, modern_tabledit: true },
      { component_index: 1, measure: 0, position: 64, absolute_position: 64, string: 2, fret: 4, effect1: 0, effect3: 0, effect2: 0, tef2_duration: 64, modern_tabledit: true }
    ]

    pairs = Tef2::FullMusicxmlBuilder.send(:build_technique_pairs, { 2 => notes })

    assert_equal "hammer-on", pairs.fetch([ 2, 0 ])[:kind]
    assert_equal false, pairs.fetch([ 2, 1 ])[:is_start]
  end

  test "renders repeat-table volta spans as ending brackets with a single backward repeat" do
    parsed = {
      measures: 17,
      notes: [],
      annotations: {},
      texts: [],
      chords: [],
      lyrics_text: "",
      time_signature: { numerator: 4, denominator: 4 },
      tempo: 120,
      strings: 5,
      tuning: [ 67, 50, 55, 59, 62 ],
      endings: [
        { measure: 0, is_open: true, is_close: false, ending_number: 0, type: :ending },
        { measure: 15, is_open: false, is_close: false, ending_number: 1, type: :ending, span: true, repeat: true },
        { measure: 16, is_open: false, is_close: false, ending_number: 2, type: :ending, span: true, repeat: false }
      ]
    }

    document = Nokogiri::XML(Tef2::FullMusicxmlBuilder.build(parsed))
    measures = document.xpath("//part/measure").map { |m| m["number"] }

    m1 = document.xpath("//part/measure[@number='1']").first
    assert_equal "forward", m1.at_xpath(".//barline[@location='left']/repeat")["direction"]
    assert_nil m1.xpath(".//ending").first

    m16 = document.xpath("//part/measure[@number='16']").first
    left_16 = m16.at_xpath(".//barline[@location='left']/ending")
    assert_equal [ "1", "start" ], [ left_16["number"], left_16["type"] ]
    right_16 = m16.xpath(".//barline[@location='right']").last
    assert_equal [ "1", "stop" ], [ right_16.at_xpath("ending")["number"], right_16.at_xpath("ending")["type"] ]
    assert_equal "backward", right_16.at_xpath("repeat")["direction"]

    m17 = document.xpath("//part/measure[@number='17']").first
    left_17 = m17.at_xpath(".//barline[@location='left']/ending")
    assert_equal [ "2", "start" ], [ left_17["number"], left_17["type"] ]
    assert_equal "stop", m17.xpath(".//barline[@location='right']").last.at_xpath("ending")["type"]
    assert_empty m17.xpath(".//repeat")

    assert_empty document.xpath("//part/measure[not(@number='16')]/barline/repeat[@direction='backward']")
  end
end
