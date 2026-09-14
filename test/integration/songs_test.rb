require "test_helper"

class SongsTest < ActionDispatch::IntegrationTest
  test "create, list and reopen a score" do
    document = { version: 1, title: "Integration roll", tempo: 100,
      tuning: [ 62, 59, 55, 50, 67 ], fretConvention: "relative-to-string-nut",
      measures: [ { beats: Array.new(4) { { duration: 4, notes: [ { string: 1, fret: 2 } ] } } } ] }
    assert_difference("Song.count", 1) do
      post api_songs_url, params: { score: document, source_text: "retained source" }, as: :json
      assert_response :created
    end
    id = response.parsed_body["id"]
    get api_song_url(id), as: :json
    assert_equal JSON.parse(document.to_json), response.parsed_body["score"]
    assert_equal "retained source", response.parsed_body["source_text"]
    get api_songs_url, as: :json
    assert_includes response.parsed_body.map { |s| s["id"] }, id
  end

  test "updates an existing score" do
    document = { version: 1, title: "Original", tempo: 100,
      tuning: [ 62, 59, 55, 50, 67 ], fretConvention: "relative-to-string-nut",
      measures: [ { beats: Array.new(4) { { duration: 4, notes: [ { string: 1, fret: 2 } ] } } } ] }
    post api_songs_url, params: { score: document }, as: :json
    id = response.parsed_body["id"]
    changed = document.merge(title: "Edited", tempo: 120)
    patch api_song_url(id), params: { score: changed, source_text: "updated source" }, as: :json
    assert_response :success
    assert_equal id, response.parsed_body["id"]
    get api_song_url(id), as: :json
    assert_equal JSON.parse(changed.to_json), response.parsed_body["score"]
    assert_equal "updated source", response.parsed_body["source_text"]
  end

  test "rejects malformed score updates" do
    song = Song.create!(title: "Existing", score: {
      "version" => 1, "title" => "Existing", "tempo" => 96,
      "tuning" => [ 62, 59, 55, 50, 67 ], "fretConvention" => "relative-to-string-nut",
      "measures" => [ { "beats" => Array.new(4) { { "duration" => 4, "notes" => [] } } } ]
    })
    patch api_song_url(song.id), params: { score: "bad" }, as: :json
    assert_response :unprocessable_entity
    patch api_song_url(song.id), params: { score: { version: 9 } }, as: :json
    assert_response :unprocessable_entity
  end

  test "invalid scores are not saved" do
    assert_no_difference("Song.count") do
      post api_songs_url, params: { score: { version: 9, title: "Invalid" } }, as: :json
      assert_response :unprocessable_entity
    end
  end

  test "create and reopen an imported MusicXML document" do
    document = { version: 2, kind: "musicxml", title: "Minor tune", sourceName: "minor.musicxml",
      sourceFormat: "musicxml", source: '<score-partwise version="4.0"></score-partwise>', warnings: [ "Compare the source." ] }
    assert_difference("Song.count", 1) do
      post api_songs_url, params: { score: document }, as: :json
      assert_response :created
    end
    id = response.parsed_body["id"]
    get api_song_url(id), as: :json
    assert_equal JSON.parse(document.to_json), response.parsed_body["score"]
  end

  test "rejects non-object and oversized score requests" do
    post api_songs_url, params: { score: "not an object" }, as: :json
    assert_response :unprocessable_entity
    assert_equal "Score must be an object.", response.parsed_body["error"]

    post api_songs_url, params: { score: { version: 1, title: "x" * 3_000_001 } }, as: :json
    assert_response :content_too_large
    assert_match(/3 MB/, response.parsed_body["error"])
  end
end
