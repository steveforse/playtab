require "test_helper"

class SongsTest < ActionDispatch::IntegrationTest
  setup { sign_in_as(User.first) }

  test "create, list and reopen a score" do
    document = { version: 1, title: "Integration roll", tempo: 100,
      tuning: [ 62, 59, 55, 50, 67 ], fretConvention: "relative-to-string-nut",
      measures: [ { beats: Array.new(4) { { duration: 4, notes: [ { string: 1, fret: 2 } ] } } } ] }
    assert_difference("Song.count", 1) do
      post api_songs_url, params: { score: document, source_text: "retained source" }, as: :json
      assert_response :created
    end
    id = response.parsed_body["id"]
    assert_equal 0, response.parsed_body["revision"]
    get api_song_url(id), as: :json
    assert_equal 0, response.parsed_body["revision"]
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
    revision = response.parsed_body["revision"]
    changed = document.merge(title: "Edited", tempo: 120)
    patch api_song_url(id), params: { score: changed, source_text: "updated source", revision: revision }, as: :json
    assert_response :success
    assert_equal id, response.parsed_body["id"]
    assert_equal revision + 1, response.parsed_body["revision"]
    get api_song_url(id), as: :json
    assert_equal JSON.parse(changed.to_json), response.parsed_body["score"]
    assert_equal "updated source", response.parsed_body["source_text"]
    assert_equal revision + 1, response.parsed_body["revision"]
    patch api_song_url(id), params: { score: document, revision: revision }, as: :json
    assert_response :conflict
    patch api_song_url(id), params: { score: document }, as: :json
    assert_response :conflict
    get api_song_url(id), as: :json
    assert_equal JSON.parse(changed.to_json), response.parsed_body["score"]
  end

  test "rejects malformed score updates" do
    song = Song.create!(user: User.first, title: "Existing", score: {
      "version" => 1, "title" => "Existing", "tempo" => 96,
      "tuning" => [ 62, 59, 55, 50, 67 ], "fretConvention" => "relative-to-string-nut",
      "measures" => [ { "beats" => Array.new(4) { { "duration" => 4, "notes" => [] } } } ]
    })
    patch api_song_url(song.id), params: { score: "bad", revision: song.lock_version }, as: :json
    assert_response :unprocessable_entity
    patch api_song_url(song.id), params: { score: { version: 9 }, revision: song.lock_version }, as: :json
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

  test "accepts TEF and PDF provenance and preserves imported edits" do
    %w[tef pdf].each do |format|
      document = { version: 2, kind: "musicxml", title: "Imported #{format}", sourceName: "tune.musicxml",
        sourceFormat: format, source: '<score-partwise version="4.0"><work-title>One</work-title></score-partwise>', warnings: [ "Check the source." ] }
      post api_songs_url, params: { score: document }, as: :json
      assert_response :created
      id = response.parsed_body["id"]
      revised = document.merge(source: '<score-partwise version="4.0"><work-title>Two</work-title></score-partwise>')
      patch api_song_url(id), params: { score: revised, revision: response.parsed_body["revision"] }, as: :json
      assert_response :success
      get api_song_url(id), as: :json
      assert_equal JSON.parse(revised.to_json), response.parsed_body["score"]
    end
  end

  test "rejects non-object and oversized score requests" do
    post api_songs_url, params: { score: "not an object" }, as: :json
    assert_response :unprocessable_entity
    assert_equal "Score must be an object.", response.parsed_body["error"]

    post api_songs_url, params: { score: { version: 1, title: "x" * 3_000_001 } }, as: :json
    assert_response :content_too_large
    assert_match(/3 MB/, response.parsed_body["error"])
  end

  test "requires authentication for the library API" do
    sign_out

    get api_songs_url, as: :json

    assert_response :unauthorized
    assert_equal "Authentication required.", response.parsed_body["error"]
  end

  test "does not expose another user's score" do
    other_user = User.create!(email_address: "other@example.com", password: "password", password_confirmation: "password")
    song = Song.create!(user: other_user, title: "Private", score: {
      "version" => 1, "title" => "Private", "tempo" => 96,
      "tuning" => [ 62, 59, 55, 50, 67 ], "fretConvention" => "relative-to-string-nut",
      "measures" => [ { "beats" => Array.new(4) { { "duration" => 4, "notes" => [] } } } ]
    })

    get api_song_url(song.id), as: :json

    assert_response :not_found
    patch api_song_url(song.id), params: { score: song.score, revision: song.lock_version }, as: :json
    assert_response :not_found
  end
end
