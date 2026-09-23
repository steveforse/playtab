require "test_helper"
require_relative "../../script/review_musicxml"

class ReviewMusicxmlTest < ActiveSupport::TestCase
  setup do
    pitch = '<pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><notehead parentheses="yes">normal</notehead>'
    @source = ("<score-partwise><part><measure><attributes><divisions>1</divisions></attributes><note>" + pitch + "<staff>1</staff></note><backup><duration>1</duration></backup><note>" + pitch + "<staff>2</staff><notations><technical><string>4</string><fret>9</fret></technical></notations></note></measure></part></score-partwise>").b
    @manifest = {
      "source_sha256" => Digest::SHA256.hexdigest(@source),
      "corrections" => [
        { "measure" => 1, "tick" => 0, "string" => 4, "expected_fret" => 9, "fret" => 5,
          "expected_midi" => 57, "midi" => 53, "finger" => 3 }
      ]
    }
  end

  test "review changes pitch and fret but keeps finger separate" do
    result = Nokogiri::XML(MusicxmlReview.correct(@source, @manifest))
    assert_equal "5", result.at_xpath("//fret").text
    assert_equal [ "F", "F" ], result.xpath("//pitch/step").map(&:text)
    assert_equal [ "3", "3" ], result.xpath("//fingering").map(&:text)
    assert_empty result.xpath("//notehead[@parentheses]")
  end

  test "mismatched source and note are rejected" do
    assert_raises(ArgumentError) { MusicxmlReview.correct(@source + " ", @manifest) }
    @manifest["corrections"][0]["expected_fret"] = 8
    assert_raises(ArgumentError) { MusicxmlReview.correct(@source, @manifest) }
  end

  test "run writes a corrected output and protects the source" do
    Tempfile.create([ "review-source", ".xml" ]) do |source|
      Tempfile.create([ "review-manifest", ".json" ]) do |manifest|
        Tempfile.create([ "review-output", ".xml" ]) do |output|
          source.binmode
          source.write(@source)
          source.flush
          manifest.write(JSON.generate(@manifest))
          manifest.flush

          MusicxmlReview.run([ source.path, manifest.path, output.path ])
          assert_equal "5", Nokogiri::XML(File.binread(output.path)).at_xpath("//fret").text
          assert_raises(ArgumentError) { MusicxmlReview.run([ source.path, manifest.path, source.path ]) }
        end
      end
    end
  end
end
