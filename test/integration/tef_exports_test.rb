require "test_helper"

class TefExportsTest < ActionDispatch::IntegrationTest
  setup { sign_in_as(User.first) }

  test "exports native scores as both supported TEF versions" do
    %w[tef2 tef3].each do |version|
      post api_tef_exports_url, params: { score: native_score("Morning / tune"), version: version }, as: :json

      assert_response :success
      body = response.parsed_body
      assert_equal "Morning-tune.tef", body["filename"]
      assert_equal version, body["version"]
      assert_empty body["warnings"]
      bytes = Base64.strict_decode64(body["content"])
      parsed = version == "tef2" ? Tef2::FullParser.parse(bytes) : Tef2::TableditV3Parser.parse(bytes)
      assert_equal [ 62, 59, 55, 50, 67 ], parsed[:tuning]
      assert_equal 2, parsed[:notes].length
    end
  end

  test "exports imported and edited MusicXML with loss warnings" do
    document = imported_document(30)
    post api_tef_exports_url, params: { score: document, version: "tef3" }, as: :json

    assert_response :success
    body = response.parsed_body
    assert_includes body["warnings"].join(" "), "Timed lyrics"
    assert_includes body["warnings"].join(" "), "rests"
    parsed = Tef2::TableditV3Parser.parse(Base64.strict_decode64(body["content"]))
    assert_equal 30, parsed[:notes].first[:fret]
  end

  test "rejects invalid requests and values TEF2 cannot encode" do
    post api_tef_exports_url, params: {}, as: :json
    assert_response :unprocessable_entity
    assert_equal "Score must be an object.", response.parsed_body["error"]

    post api_tef_exports_url, params: { score: native_score("Tune"), version: "unknown" }, as: :json
    assert_response :unprocessable_entity
    assert_equal "Unsupported TEF export version.", response.parsed_body["error"]

    post api_tef_exports_url, params: { score: imported_document(30), version: "tef2" }, as: :json
    assert_response :unprocessable_entity
    assert_equal "TEF2 cannot represent frets above 24.", response.parsed_body["error"]

    post api_tef_exports_url, params: { padding: "x" * 3_000_001 }, as: :json

    assert_response :content_too_large
    assert_equal "Score is too large (3 MB maximum).", response.parsed_body["error"]
  end

  private

  def native_score(title)
    {
      version: 1, title: title, tempo: 96, tuning: [ 62, 59, 55, 50, 67 ], fretConvention: "relative-to-string-nut",
      measures: [ { beats: [
        { duration: 4, notes: [ { string: 1, fret: 0 } ] },
        { duration: 4, notes: [ { string: 2, fret: 2 } ] },
        { duration: 4, notes: [] },
        { duration: 4, notes: [] }
      ] } ]
    }
  end

  def imported_document(fret)
    {
      version: 2, kind: "musicxml", title: "Imported", sourceName: "import.musicxml", sourceFormat: "musicxml",
      source: <<~XML, warnings: []
        <score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Banjo</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>960</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staff-details number="2"><staff-lines>5</staff-lines><staff-tuning line="1"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="2"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="3"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="4"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning><staff-tuning line="5"><tuning-step>D</tuning-step><tuning-octave>4</tuning-octave></staff-tuning></staff-details></attributes><note><pitch><step>D</step><octave>4</octave></pitch><duration>960</duration><voice>1</voice><staff>2</staff><notations><technical><string>1</string><fret>#{fret}</fret><fingering>1</fingering></technical></notations><lyric><text>Well</text></lyric></note><backup><duration>960</duration></backup><note><rest/><duration>960</duration><voice>1</voice><staff>2</staff></note><harmony><root><root-step>G</root-step></root><kind>major</kind></harmony><direction><direction-type><words>Verse</words></direction-type></direction></measure></part></score-partwise>
      XML
    }
  end
end
