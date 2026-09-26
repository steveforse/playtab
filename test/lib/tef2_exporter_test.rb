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
    footer = result[:bytes].byteslice(-Tef2::Exporter::LegacyWriter::FOOTER_SIZE, Tef2::Exporter::LegacyWriter::FOOTER_SIZE)
    assert_equal "Page &p / &n", footer.byteslice(96, 12)
    assert_equal "&c&2&t &c&6&s &r&3&m ", footer.byteslice(224, 21).delete("\0")
    assert_equal "&r&3&t - &3&s ", footer.byteslice(352, 15).delete("\0")

    tail_offset = Tef2::FullParser::HEADER_SIZE + parsed[:component_count] * Tef2::FullParser::COMPONENT_SIZE
    parsed[:texts].length.times do
      length = result[:bytes].getbyte(tail_offset)
      assert_equal 0, result[:bytes].getbyte(tail_offset + 1)
      tail_offset += length + 2
    end
    tail_offset += parsed[:chords].length * 32
    lyrics_length = result[:bytes].byteslice(tail_offset, 2).unpack1("v")
    assert result[:bytes].byteslice(tail_offset + 2, 9).start_with?("LYRICS &")
    assert_equal 0, result[:bytes].getbyte(tail_offset + 2 + lyrics_length - 1)
    tail_offset += lyrics_length + 2
    assert_equal 5, result[:bytes].getbyte(tail_offset)
    assert_equal 99, result[:bytes].getbyte(tail_offset + 4)
    assert_equal 16, result[:bytes].getbyte(tail_offset + 16)
    assert_equal 7, result[:bytes].getbyte(tail_offset + 17)
    assert_equal "Imported", result[:bytes].byteslice(tail_offset + 32, 16).delete("\0")
    assert_equal 480, result[:bytes].length - tail_offset - 50
    chord_offset = Tef2::FullParser::HEADER_SIZE + parsed[:component_count] * Tef2::FullParser::COMPONENT_SIZE
    parsed[:texts].each { |text| chord_offset += result[:bytes].getbyte(chord_offset) + 2 }
    assert_equal [ 0, 0, 0, 0, 0, 255 ], result[:bytes].byteslice(chord_offset, 6).bytes
    assert_equal [ "Verse" ], parsed[:texts].map { |text| text[:text] }
    assert_equal [ "G" ], parsed[:chords].map { |chord| chord[:name] }
    assert_includes parsed[:lyrics_text], "LYRICS & CHORDS"
    assert_includes parsed[:lyrics_text], "Row one"
    assert_equal [ 1, 2, 3, 4 ], parsed[:notes].map { |note| note[:effect1] }
    assert_equal [ 2, 3, 6, 5 ], parsed[:notes].map { |note| note[:annotation] }

    model = Tef2::Exporter::Model.new(
      title: "Overlapping annotations", tempo: 120, tuning: [ 62, 59, 55, 50, 67 ],
      measures: [ { numerator: 4, denominator: 4 } ],
      notes: [
        { measure: 0, position: 0, duration: 256, string: 0, fret: 0, effect1: 0, effect2: 0, effect3: 0, annotation: nil },
        { measure: 0, position: 0, duration: 256, string: 0, fret: 3, effect1: 0, effect2: 0, effect3: 0, annotation: nil }
      ],
      texts: [ { measure: 0, position: 0, text: "Verse" }, { measure: 0, position: 0, text: "Verse" } ],
      chords: [ { measure: 0, position: 0, name: "C" }, { measure: 0, position: 0, name: "C" } ],
      lyrics: nil, warnings: []
    )
    bytes = Tef2::Exporter::LegacyWriter.build(model)
    component_count = bytes.byteslice(256, 2).unpack1("v")
    locations = component_count.times.map do |index|
      bytes.byteslice(258 + index * 6, 2).unpack1("v")
    end
    assert_equal locations.uniq.sort, locations.sort
    assert_equal 3, component_count
    occupied = (0...(5 * 256)).to_h { |position| [ position, true ] }
    assert_equal [ nil, nil ], Tef2::Exporter::LegacyWriter.available_marker_position(
      { measure: 0, position: 0, string: 0 }, occupied
    )

    chord_model = Tef2::Exporter::Model.from(
      "version" => 2,
      "title" => "Chord positions",
      "source" => <<~XML
        <score-partwise><part><measure number="1"><attributes><divisions>960</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <direction data-playtab-string="4"><direction-type><words>Verse</words></direction-type><offset>240</offset></direction><direction data-playtab-string="4"><direction-type><words>Verse</words></direction-type><offset>240</offset></direction>
        <harmony data-playtab-string="3" data-playtab-strings="0,2,2,1,-1" data-playtab-first-fret="2"><root><root-step>G</root-step></root><kind text=" min">major</kind><offset>240</offset></harmony><harmony data-playtab-string="3" data-playtab-strings="0,2,2,1,-1" data-playtab-first-fret="2"><root><root-step>G</root-step></root><kind text=" min">major</kind><offset>240</offset></harmony>
        <note><pitch><step>G</step><octave>3</octave></pitch><duration>960</duration><staff>2</staff><notations><technical><string>1</string><fret>0</fret><other-technical>TEF fingering code 6</other-technical></technical></notations></note>
        <note><chord/><pitch><step>D</step><octave>3</octave></pitch><duration>960</duration><staff>2</staff><notations><technical><string>2</string><fret>0</fret></technical></notations></note>
        </measure></part></score-partwise>
      XML
    )
    assert_equal [ [ 0, 0 ], [ 0, 1 ] ], chord_model.notes.map { |note| [ note[:position], note[:string] ] }
    assert_equal [ [ 64, "Verse" ] ], chord_model.texts.map { |text| [ text[:position], text[:text] ] }
    assert_equal [ [ 64, "G min" ] ], chord_model.chords.map { |chord| [ chord[:position], chord[:name] ] }
    assert_equal [ 4 ], chord_model.texts.map { |text| text[:string] }
    assert_equal [ [ 3, [ 0, 2, 2, 1, -1 ], 2 ] ], chord_model.chords.map { |chord| [ chord[:string], chord[:strings], chord[:first_fret] ] }
    assert_equal 6, chord_model.notes.first[:annotation]

    tef2_chord = Tef2::FullParser.parse(Tef2::Exporter::LegacyWriter.build(chord_model))[:chords].first
    tef3_bytes = Tef2::Exporter::TableditWriter.build(chord_model)
    tef3_chord = Tef2::TableditV3Parser.parse(tef3_bytes)[:chords].first
    assert_equal [ 0x10, 0x00, 0x01, 0x03 ], tef3_bytes.byteslice(0, 4).bytes
    assert_equal 0x00A2, tef3_bytes.byteslice(4, 2).unpack1("v")
    assert_equal 0x0301, tef3_bytes.byteslice(0x1C, 2).unpack1("v")
    assert_equal 0x100, tef3_bytes.byteslice(0x40, 4).unpack1("V")
    lyrics_offset = tef3_bytes.byteslice(0x4C, 4).unpack1("V")
    text_block_offset = tef3_bytes.byteslice(0x50, 4).unpack1("V")
    assert_equal 1, tef3_bytes.byteslice(lyrics_offset, 2).unpack1("v")
    assert_equal [ 1, 0, 0 ], tef3_bytes.byteslice(text_block_offset, 3).bytes
    assert_equal text_block_offset + 3, tef3_bytes.byteslice(0x54, 4).unpack1("V")
    assert_equal 12, tef3_bytes.byteslice(tef3_bytes.byteslice(0x5C, 4).unpack1("V"), 2).unpack1("v")
    assert_equal 36, tef3_bytes.byteslice(tef3_bytes.byteslice(0x58, 4).unpack1("V"), 2).unpack1("v")
    assert_equal [ 0, 2, 2, 1, -1 ], tef2_chord[:strings]
    assert_equal [ 0, 2, 2, 1, -1 ], tef3_chord[:strings]
    assert_equal 2, tef3_chord[:first_fret]
  end

  test "round trips TEF3 tuplets, grace notes, ties and thumb fingering" do
    model = Tef2::Exporter::Model.new(
      title: "Tuplets", tempo: 120, tuning: [ 62, 59, 55, 50, 67 ],
      measures: [ { numerator: 3, denominator: 4 }, { numerator: 4, denominator: 4 } ],
      notes: [ { measure: 1, position: 0, duration: 256, string: 0, fret: 4, effect1: 1, effect2: 0, effect3: 0, annotation: 6, fingering: "T", tie: true, tuplet: true, grace: true },
               { measure: 1, position: 256, duration: 256, string: 0, fret: 4, effect1: 0, effect2: 0, effect3: 0, dynamic: 5 } ],
      texts: [], chords: [], lyrics: nil, warnings: []
    )
    result = Tef2::Exporter.export({ "version" => 1, "title" => "x", "tempo" => 120, "tuning" => [ 62, 59, 55, 50, 67 ], "measures" => [ { "beats" => Array.new(4) { { "duration" => 4, "notes" => [ { "string" => 1, "fret" => 0 } ] } } } ] }, version: "tef3")
    parsed = Tef2::TableditV3Parser.parse(result[:bytes])
    assert_equal false, parsed[:notes].first[:tuplet]

    bytes = Tef2::Exporter::TableditWriter.build(model)
    assert_equal [ 4, 0, 4, 10 ], bytes.byteslice(0xCA, 4).bytes
    note, continuation = Tef2::TableditV3Parser.parse(bytes)[:notes]
    assert_equal [ "T" ], note[:fingerings]
    assert note[:grace]
    assert note[:tie]
    assert note[:tuplet]
    # TablEdit marks the second note of a tie with the dynamic value 7.
    assert continuation[:tied_from_previous]
    assert_nil continuation[:dynamic]
    refute continuation[:tie]
  end

  test "round trips TEF3 note and instrument fields through import and export" do
    notes = [
      { string: 0, fret: 2, dynamic: 5, stroke: 6, effect2: 4 },
      { string: 1, fret: 3, effect3: 6 },
      { string: 2, fret: 0, effect1: 6, effect3: 12 },
      { string: 3, fret: 5, effect2: 7, grace: true, grace_fret: 3, grace_effect: 2 },
      { string: 4, fret: 7, dynamic: 0 },
      { string: 0, fret: 4, effect1: 11, fingering: "T" },
      { string: 1, fret: 5, effect1: 5, left_finger: 2, right_hand: "I" },
      { string: 2, fret: 1, effect1: 8, effect3: 9 },
      { string: 3, fret: 2, effect3: 5, right_hand: "M" },
      { string: 1, fret: 6, effect2: 3, left_finger: 4, right_hand: "T", voice: 2 }
    ].each_with_index.map do |note, index|
      { measure: index / 8, position: (index % 8) * 128, duration: 128, effect1: 0, effect2: 0, effect3: 0, dynamic: 2, stroke: 0, tie: false, grace: false }.merge(note)
    end
    source = Tef2::Exporter::Model.new(
      title: "Fields", tempo: 100, tuning: [ 62, 59, 55, 50, 67 ], measures: Array.new(2) { { numerator: 4, denominator: 4 } },
      notes: notes, texts: [], chords: [], lyrics: nil, warnings: [],
      instrument: { midi_voice: 25, midi_bank: 1, capo: 2, banjo5: 18, clef: 1, middle_c: 3 }
    )
    original = Tef2::TableditV3Parser.parse(Tef2::Exporter::TableditWriter.build(source))
    imported = Tef2.convert(Tef2::Exporter::TableditWriter.build(source))
    assert_includes imported[:warnings], "Native Ruby TablEdit 3.00 conversion"

    result = Tef2::Exporter.export({ "version" => 2, "title" => "Fields", "source" => imported[:musicxml] }, version: "tef3")
    exported = Tef2::TableditV3Parser.parse(result[:bytes])
    fields = %i[string fret dynamic stroke effect1 effect2 effect3 grace grace_note_fret grace_note_effect fingering_combo fingerings tie voice attributes]
    assert_equal original[:notes].map { |note| note.slice(*fields) }, exported[:notes].map { |note| note.slice(*fields) }
    instrument = %i[midi_voice midi_bank capo banjo5 clef middle_c output]
    assert_equal original[:track_data].first.slice(*instrument), exported[:track_data].first.slice(*instrument)
    assert_equal({ midi_voice: 25, midi_bank: 1, capo: 2, banjo5: 18, clef: 1, middle_c: 3, output: 0x0710 }, exported[:track_data].first.slice(*instrument))
    assert_equal [ 5, 6, 4 ], original[:notes].first.values_at(:dynamic, :stroke, :effect2)
    assert_equal [ [ 2, "I" ], [ "M" ], [ 4, "T" ] ], original[:notes].last(4).map { |note| note[:fingerings] }.values_at(0, 2, 3)
    document = Nokogiri::XML(imported[:musicxml])
    tab = document.xpath("//note[staff='2' and not(grace)]")
    assert_equal [ 6, 7, 8, 9 ].map { |index| tab[index].at_xpath("./notations/arpeggiate") ? 1 : 0 }, [ 1, 0, 1, 1 ]
    assert_equal "yes", tab[7].at_xpath("./notehead")["parentheses"], "a combination ghost note"
    assert_includes tab[7].xpath(".//other-technical").map(&:text), "TEF muted"
    assert_equal [ "TEF brush", "TEF fingering I" ], tab[6].xpath(".//other-technical").map(&:text) & [ "TEF brush", "TEF fingering I" ]
    refute original[:notes].first[:tie], "a dynamic above 3 is not a tie"
    refute_includes result[:warnings], "Some MusicXML techniques are not represented in the selected TEF export."
    assert_empty exported[:texts]
  end

  test "reads the capo element, program and graces from MusicXML that did not come from TEF" do
    grace = '<note><grace slash="yes"/><pitch><step>A</step><octave>3</octave></pitch><voice>1</voice><notations><technical><string>3</string><fret>2</fret></technical></notations></note>'
    after = '<note><grace slash="yes" steal-time-previous="25"/><pitch><step>A</step><octave>3</octave></pitch><voice>1</voice><notations><technical><string>1</string><fret>2</fret></technical></notations></note>'
    main = ->(string, fret, extra = "") { "<note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>#{extra}<notations><technical><string>#{string}</string><fret>#{fret}</fret></technical></notations></note>" }
    source = <<~XML
      <score-partwise><part-list><score-part id="P1"><part-name>Banjo</part-name><score-instrument id="P1-I1"><instrument-name>Banjo</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>26</midi-program></midi-instrument></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staff-details><capo>3</capo></staff-details></attributes>
      #{grace}#{main.("3", 4)}#{main.("5", 0, '<notehead parentheses="yes">normal</notehead>')}#{main.("1", 0)}#{after}#{main.("2", 1)}</measure></part></score-partwise>
    XML
    result = Tef2::Exporter.export({ "version" => 2, "title" => "Other", "source" => source }, version: "tef3")
    parsed = Tef2::TableditV3Parser.parse(result[:bytes])
    assert_equal [ 3, 25 ], parsed[:track_data].first.values_at(:capo, :midi_voice)
    assert_equal [ [ 2, 4, true, 2, 0, 2 ], [ 4, 3, false, 0, 4, 2 ], [ 0, 0, false, 0, 0, 2 ], [ 1, 1, false, 0, 0, 2 ] ],
      parsed[:notes].map { |note| [ note[:string], note[:fret], note[:grace], note[:grace] ? note[:grace_note_fret] : 0, note[:effect2], note[:dynamic] ] }
    assert_includes result[:warnings], "Some grace notes are not represented: TablEdit keeps one grace note before a note on the same string."

    legacy = source.sub("<midi-program>26</midi-program>", "<midi-program>105</midi-program>").sub("<capo>3</capo>", "")
      .sub("<attributes>", "<direction><direction-type><words>Capo 2</words></direction-type></direction><attributes>")
      .sub("</part-list>", '</part-list><identification><miscellaneous><miscellaneous-field name="playtab-fifth-string-capo">9</miscellaneous-field></miscellaneous></identification>')
    result = Tef2::Exporter.export({ "version" => 2, "title" => "Other", "source" => legacy }, version: "tef3")
    parsed = Tef2::TableditV3Parser.parse(result[:bytes])
    assert_equal [ 2, 105 ], parsed[:track_data].first.values_at(:capo, :midi_voice)
    assert_empty parsed[:texts]
    assert_equal 2, parsed[:notes][1][:fret], "5th-string frets are written absolute"
    assert_includes result[:warnings], "The 5th-string capo is written at capo + 5; fret 9 is not represented."
  end

  test "round trips per-measure keys and time signatures and warns about later tempo changes" do
    signatures = [ { numerator: 3, denominator: 4 }, { numerator: 4, denominator: 4 }, { numerator: 6, denominator: 8 } ]
    notes = signatures.each_index.map { |measure| { measure: measure, position: 0, duration: 256, string: 1, fret: measure, effect1: 0, effect2: 0, effect3: 0, tie: false, grace: false } }
    model = Tef2::Exporter::Model.new(title: "Meters", tempo: 96, tuning: [ 62, 59, 55, 50, 67 ], measures: signatures,
      notes: notes, texts: [], chords: [], lyrics: nil, warnings: [], keys: [ 3, 3, -2 ])
    musicxml = Tef2.convert(Tef2::Exporter::TableditWriter.build(model))[:musicxml]
    assert_equal [ "3", "-2" ], Nokogiri::XML(musicxml).xpath("//key/fifths").map(&:text)
    result = Tef2::Exporter.export({ "version" => 2, "title" => "Meters", "source" => musicxml }, version: "tef3")
    parsed = Tef2::TableditV3Parser.parse(result[:bytes])
    assert_equal signatures, parsed[:measure_signatures]
    assert_equal [ 3, 3, -2 ], parsed[:measure_keys]
    assert_equal 96, parsed[:tempo]
    refute_includes result[:warnings], "TEF export keeps the opening tempo; later tempo changes are not represented."

    faster = musicxml.sub('<measure number="3">', '<measure number="3"><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>132</per-minute></metronome></direction-type><sound tempo="132"/></direction>')
    result = Tef2::Exporter.export({ "version" => 2, "title" => "Meters", "source" => faster }, version: "tef3")
    assert_includes result[:warnings], "TEF export keeps the opening tempo; later tempo changes are not represented."
  end

  test "writes the tablature staff's second voice as TablEdit's lower voice" do
    note = ->(voice, string, fret) { "<note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><voice>#{voice}</voice><notations><technical><string>#{string}</string><fret>#{fret}</fret></technical></notations></note>" }
    lanes = ->(*voices) { voices.each_with_index.map { |voice, index| (index.zero? ? "" : "<backup><duration>4</duration></backup>") + note.(voice, index + 1, index) + note.(voice, index + 1, index + 2) }.join }
    xml = ->(body) { "<score-partwise><part-list><score-part id=\"P1\"/></part-list><part id=\"P1\"><measure number=\"1\"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>#{body}</measure></part></score-partwise>" }
    result = Tef2::Exporter.export({ "version" => 2, "title" => "Voices", "source" => xml.(lanes.("2", "3")) }, version: "tef3")
    assert_equal [ [ 0, 1 ], [ 0, 1 ], [ 1, 2 ], [ 1, 2 ] ], Tef2::TableditV3Parser.parse(result[:bytes])[:notes].map { |parsed| parsed.values_at(:string, :voice) }.sort
    refute result[:warnings].any? { |warning| warning.include?("two voices") }

    crowded = Tef2::Exporter.export({ "version" => 2, "title" => "Voices", "source" => xml.(lanes.("1", "2", "3")) }, version: "tef3")
    assert_includes crowded[:warnings], "TEF export keeps two voices per measure; later voices join the first."
    tef2 = Tef2::Exporter.export({ "version" => 2, "title" => "Voices", "source" => xml.(lanes.("1", "2")) }, version: "tef2")
    assert_includes tef2[:warnings], "TEF2 export writes the second voice's notes into the first voice."
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
