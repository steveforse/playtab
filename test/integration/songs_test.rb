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
end
