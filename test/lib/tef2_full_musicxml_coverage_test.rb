require "test_helper"

class Tef2FullMusicxmlCoverageTest < ActiveSupport::TestCase
  test "builds all native MusicXML note, metadata and technique branches" do
    notes = [
      native_note(0, 0, 64, 0, 0, 1, 4, [], 1),
      native_note(1, 0, 128, 0, 2, 0, 12, [ 2 ], 0),
      native_note(2, 1, 64, 0, 2, 2, 13, [ "T" ], 1),
      native_note(3, 1, 128, 0, 1, 0, 0, [], 0)
    ]
    parsed = {
      measures: 3,
      notes: notes,
      annotations: { 0 => 2, 1 => 9 },
      texts: [ { measure: 0, position: 64, text: "Verse" }, { measure: 0, position: 1024, text: "Tail" }, { measure: 0, position: 64, text: "" } ],
      chords: [ { measure: 0, position: 64, name: "Bb7" }, { measure: 0, position: 1024, name: "Tail" }, { measure: 0, position: 128, name: "" }, { measure: 1, position: 0, name: "sus" } ],
      time_signature: { numerator: 4, denominator: 4 },
      measure_signatures: [ { numerator: 4, denominator: 4 }, { numerator: 3, denominator: 4 }, { numerator: 3, denominator: 4 } ],
      tempo: 120,
      strings: 5,
      tuning: [ 63, 60, 55, 48, 67 ],
      lyrics_text: "plain metadata"
    }

    document = Nokogiri::XML(Tef2::FullMusicxmlBuilder.build(parsed))

    assert_equal 3, document.xpath("//part/measure").length
    assert_equal 4, document.xpath("//part/measure[1]//rest").length
    assert_equal 1, document.xpath("//part/measure[2]/attributes/time").length
    assert_equal [ "7", "Tail", "sus" ], document.xpath("//harmony/kind").map { |node| node["text"] }.uniq
    assert_equal [ "hammer-on", "pull-off" ], document.xpath("//part/measure//hammer-on | //part/measure//pull-off").map(&:name).uniq
    assert_equal 6, document.xpath("//bend").length
    assert_includes document.xpath("//other-technical").map(&:text), "TEF fingering code 9"
    assert_includes document.xpath("//fingering").map(&:text), "2"
    assert_includes document.xpath("//other-technical").map(&:text), "TEF fingering T"
  end

  test "covers full MusicXML scalar helpers and pair directions" do
    assert_equal [ "C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B" ],
      (60..71).map { |pitch| Tef2::FullMusicxmlBuilder.send(:pitch_step, pitch) }
    assert_equal [ 0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0 ],
      (60..71).map { |pitch| Tef2::FullMusicxmlBuilder.send(:pitch_alter, pitch) }
    assert_equal 4, Tef2::FullMusicxmlBuilder.send(:pitch_octave, 60)
    assert_equal [ "whole", "half", "quarter", "eighth", "16th", "32nd", "quarter" ],
      [ 3840, 1920, 960, 480, 240, 120, 121 ].map { |duration| Tef2::FullMusicxmlBuilder.send(:note_type, duration) }
    assert_equal 960, Tef2::FullMusicxmlBuilder.send(:tef2_to_xml_duration, 256)
    assert_equal 768, Tef2::FullMusicxmlBuilder.send(:tef2_ticks_per_measure, numerator: 3, denominator: 4)

    notes = {
      0 => [ native_note(0, 0, 0, 0, 4, 1, 0, [], 0, modern: true), native_note(1, 0, 64, 0, 5, 0, 0, [], 0, modern: true) ],
      1 => [ native_note(2, 0, 0, 1, 4, 2, 0, [], 0), native_note(3, 0, 64, 1, 2, 0, 0, [], 0) ]
    }
    pairs = Tef2::FullMusicxmlBuilder.send(:build_technique_pairs, notes)
    assert_equal "hammer-on", pairs[[ 0, 0 ]][:kind]
    assert_equal "pull-off", pairs[[ 1, 2 ]][:kind]

    modern_effect3 = {
      0 => [ native_note(4, 0, 0, 2, 2, 0, 0, [], 0, modern: true).merge(effect3: 1),
             native_note(5, 0, 64, 2, 4, 0, 0, [], 0, modern: true) ]
    }
    assert_equal "hammer-on", Tef2::FullMusicxmlBuilder.send(:build_technique_pairs, modern_effect3)[[ 0, 4 ]][:kind]

    assert_equal "C", Tef2::FullMusicxmlBuilder.send(:pitch_step, 60)
    assert_equal [ "quarter", "quarter" ], [ Tef2::FullMusicxmlBuilder.send(:note_type, 0), Tef2::FullMusicxmlBuilder.send(:note_type, 100) ]
  end

  test "exports verified TEF effects, slides, ties, tuplets and grace notes" do
    notes = [
      native_note(0, 0, 0, 0, 0, 0, 3, [], 0).merge(tie: true),
      native_note(1, 0, 256, 0, 2, 0, 6, [], 0).merge(tie: false, tuplet: true),
      native_note(2, 0, 512, 0, 3, 0, 9, [], 0).merge(grace: true, grace_note_fret: 1, grace_note_effect: 1),
      native_note(3, 0, 768, 0, 4, 0, 15, [], 0).merge(effect2: 7, effect3: 0, tie: false)
    ]
    parsed = {
      measures: 1, notes: notes, annotations: {}, texts: [], chords: [], endings: [],
      tempo_changes: [ { measure: 0, position: 256, tempo: 90 }, { measure: 0, position: 1024, tempo: 80 } ],
      time_signature: { numerator: 4, denominator: 4 },
      measure_signatures: [ { numerator: 4, denominator: 4 } ], tempo: 120,
      strings: 5, tuning: [ 63, 60, 55, 48, 67 ]
    }

    document = Nokogiri::XML(Tef2::FullMusicxmlBuilder.build(parsed))

    assert_equal 4, document.xpath("//slide").length
    assert_equal 4, document.xpath("//tied").length
    assert_equal 2, document.xpath("//time-modification").length
    assert_equal 2, document.xpath("//grace").length
    assert_equal 2, document.xpath("//harmonic/natural").length
    assert_equal 2, document.xpath("//tap").length
    assert_equal 2, document.xpath("//notehead[text()='x']").length
    assert_equal 2, document.xpath("//staccato").length
    assert_includes document.xpath("//other-technical").map(&:text), "TEF grace effect 1"
    assert_includes document.xpath("//per-minute").map(&:text), "90"
    assert_includes document.xpath("//per-minute").map(&:text), "80"
  end

  test "exports secondary TEF effects and repeat barlines" do
    notes = [
      native_note(0, 0, 0, 0, 0, 0, 14, [], 0),
      native_note(1, 0, 64, 0, 1, 0, 10, [], 0),
      native_note(2, 0, 128, 0, 2, 0, 11, [], 0),
      native_note(3, 0, 192, 0, 3, 0, 0, [], 0).merge(effect2: 1),
      native_note(4, 0, 256, 0, 4, 0, 0, [], 0).merge(effect2: 2),
      native_note(5, 0, 320, 0, 5, 0, 0, [], 0).merge(effect2: 4),
      native_note(6, 0, 384, 0, 6, 0, 0, [], 0).merge(effect2: 8),
      native_note(7, 0, 448, 0, 7, 0, 0, [], 0).merge(effect2: 9),
      native_note(8, 0, 512, 0, 8, 0, 0, [], 0).merge(effect2: 0x30),
      native_note(9, 0, 576, 0, 9, 0, 0, [], 0).merge(effect3: 6),
      native_note(10, 0, 640, 0, 10, 0, 0, [], 0).merge(effect3: 7),
      native_note(11, 0, 704, 0, 11, 0, 0, [], 0).merge(effect3: 3),
      native_note(12, 0, 768, 0, 12, 0, 7, [], 0).merge(effect2: 4)
    ]
    parsed = {
      measures: 1, notes: notes, annotations: {}, texts: [], chords: [],
      endings: [
        { measure: 0, is_open: true, is_close: false, ending_number: 0 },
        { measure: 0, is_open: false, is_close: true, ending_number: 2 },
        { measure: 0, is_open: false, is_close: false, ending_number: 1 }
      ], tempo_changes: [],
      time_signature: { numerator: 4, denominator: 4 }, measure_signatures: [ { numerator: 4, denominator: 4 } ],
      tempo: 120, strings: 5, tuning: [ 63, 60, 55, 48, 67 ]
    }

    document = Nokogiri::XML(Tef2::FullMusicxmlBuilder.build(parsed))

    assert_equal 6, document.xpath("//arpeggiate").length
    assert_equal 2, document.xpath("//ornaments/wavy-line").length
    assert_equal 2, document.xpath("//ornaments/tremolo").length
    assert_equal 4, document.xpath("//notehead[@parentheses='yes']").length
    assert_equal 2, document.xpath("//harmonic/natural").length
    assert_equal 4, document.xpath("//harmonic/artificial").length
    assert_equal 1, document.xpath("//barline/repeat[@direction='forward']").length
    assert_equal 1, document.xpath("//barline/repeat[@direction='backward'][@times='1']").length
    assert_equal 1, document.xpath("//barline/ending[@type='start']").length

    simple_repeat = parsed.merge(endings: [ { measure: 0, is_open: false, is_close: true, ending_number: 1 } ])
    simple_document = Nokogiri::XML(Tef2::FullMusicxmlBuilder.build(simple_repeat))
    assert_equal 1, simple_document.xpath("//barline/repeat[@direction='backward'][not(@times)]").length
  end

  private

  def native_note(index, measure, position, string, fret, technique, effect1, fingerings, stroke, modern: false)
    {
      index: index, component_index: index, measure: measure, position: position,
      absolute_position: measure * 1024 + position, string: string, fret: fret,
      technique: technique, effect1: effect1, effect3: nil, tef2_duration: 64,
      is_chord: false, fingerings: fingerings, stroke: stroke, modern_tabledit: modern
    }
  end
end
