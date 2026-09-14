require "test_helper"

class Tef2TimelineMusicxmlCoverageTest < ActiveSupport::TestCase
  test "builds a sorted timeline with explicit rests and inferred strings" do
    components = [
      { measure: 0, position: 4, fret: 3, duration: 1, effect1: 1, effect2: 2 },
      { measure: 0, position: 0, fret: 0, duration: 1, effect1: 0, effect2: 0 },
      { measure: 1, position: 0, fret: 26, duration: 1, effect1: 0, effect2: 0 }
    ]
    timeline = Tef2::Timeline.build(measures: 2, components: components)

    assert_equal [ true, false, true, true ], timeline.map { |entry| entry[:rest] }
    assert_equal [ 0, 60, 75, 3840 ], timeline.map { |entry| entry[:tick] }
    assert_equal 1, Tef2::Timeline.infer_string(measure: 0, position: 0)
    assert_equal 5, Tef2::Timeline.infer_string(measure: 0, position: 4)
    assert Tef2::Timeline.valid_note?(fret: 1)
    refute Tef2::Timeline.valid_note?(fret: 0)
    refute Tef2::Timeline.valid_note?(fret: 26)
  end

  test "builds fallback MusicXML with rests, techniques, tuning and annotations" do
    timeline = [
      { index: nil, tick: 0, measure: 0, position: 0, duration: 15, rest: true },
      { index: 0, tick: 15, measure: 0, position: 1, string: 1, fret: 2, duration: 15, effect1: 1, effect2: 0, rest: false },
      { index: 1, tick: 30, measure: 0, position: 2, string: 1, fret: 1, duration: 15, effect1: 0, effect2: 0, rest: false },
      { index: 2, tick: 45, measure: 0, position: 3, string: 1, fret: 0, duration: 15, effect1: 0, effect2: 0, rest: false }
    ]
    xml = Tef2::MusicXmlBuilder.build(measures: 1, timeline: timeline, annotations: { 0 => 2, 1 => 6 }, tuning: [ 63, 60, 55, 48, 67 ])
    document = Nokogiri::XML(xml)

    assert_equal 1, document.xpath("//measure").length
    assert_equal 1, document.xpath("//rest").length
    assert_equal 1, document.xpath("//hammer-on[@type='start']").length
    assert_equal 0, document.xpath("//pull-off[@type='start']").length
    assert_equal [ "1" ], document.xpath("//fingering").map(&:text)
    assert_equal [ "TEF fingering code 6" ], document.xpath("//other-technical").map(&:text)
    assert_equal "G", document.at_xpath("//staff-tuning[1]/tuning-step").text
  end

  test "covers fallback MusicXML helper formats" do
    durations = [ 3840, 1920, 960, 480, 240, 120, 121 ]
    assert_equal %w[whole half quarter eighth 16th 32nd quarter], durations.map { |duration| Tef2::MusicXmlBuilder.send(:note_type, duration) }
    assert_equal "C#", Tef2::MusicXmlBuilder.send(:pitch_step, 61)
    assert_equal 5, Tef2::MusicXmlBuilder.send(:pitch_octave, 60)
    pairs = Tef2::MusicXmlBuilder.send(:build_technique_pairs, [
      { string: 1, tick: 0, index: 0, effect1: 1, rest: false },
      { string: 1, tick: 1, index: 1, effect1: 2, rest: false },
      { string: 1, tick: 2, index: 2, effect1: 0, rest: false },
      { string: 2, tick: 0, index: 3, effect1: 0, rest: true }
    ])
    assert_equal "hammer-on", pairs[[ 1, 0 ]][:kind]
    assert_equal "pull-off", pairs[[ 1, 1 ]][:kind]
  end
end
