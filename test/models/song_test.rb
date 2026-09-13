require "test_helper"

class SongTest < ActiveSupport::TestCase
  def score
    { "version" => 1, "title" => "Test roll", "tempo" => 96,
      "tuning" => [ 62, 59, 55, 50, 67 ], "fretConvention" => "relative-to-string-nut",
      "measures" => [ { "beats" => Array.new(8) { { "duration" => 8, "notes" => [ { "string" => 5, "fret" => 0 } ] } } } ] }
  end

  def imported_score
    { "version" => 2, "kind" => "musicxml", "title" => "Minor tune", "sourceName" => "minor.musicxml",
      "sourceFormat" => "musicxml", "source" => '<score-partwise version="4.0"></score-partwise>', "warnings" => [] }
  end

  test "persists a validated document and its source" do
    song = Song.create!(title: "Test roll", score: score, source_text: "original")
    assert_equal score, song.reload.score
    assert_equal "original", song.source_text
  end

  test "rejects incorrect tuning and malformed documents" do
    invalid = score.merge("tuning" => [ 64, 59, 55, 50, 67 ])
    assert_not Song.new(title: "Invalid", score: invalid).valid?
    assert_not Song.new(title: "Invalid", score: score.merge("measures" => [ nil ])).valid?
    assert_not Song.new(title: "Invalid", score: nil).valid?
  end

  test "persists an imported MusicXML document" do
    song = Song.create!(title: imported_score["title"], score: imported_score)
    assert_equal imported_score, song.reload.score
  end

  test "rejects unsafe imported MusicXML documents" do
    assert_not Song.new(title: "Invalid", score: imported_score.merge("source" => '<!ENTITY unsafe "x"><score-partwise/>')).valid?
    assert_not Song.new(title: "Invalid", score: imported_score.merge("source" => "<score-partwise>")).valid?
    assert_not Song.new(title: "Invalid", score: imported_score.merge("sourceFormat" => "pdf")).valid?
  end
end
