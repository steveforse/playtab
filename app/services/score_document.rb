# Bounded v1: one five-string track, full 4/4 measures, equal beats.
# Keep in sync with app/frontend/music/score.ts and contract fixtures.
class ScoreDocument
  class Invalid < StandardError; end

  def self.validate!(score)
    fail_with("must be an object") unless score.is_a?(Hash)
    fail_with("unsupported version") unless score["version"] == 1
    fail_with("invalid title") unless score["title"].is_a?(String) && score["title"].strip.length.between?(1, 160)
    fail_with("tempo must be 30–240") unless score["tempo"].is_a?(Integer) && score["tempo"].between?(30, 240)
    fail_with("only open G tuning is supported") unless score["tuning"] == [ 62, 59, 55, 50, 67 ]
    fail_with("invalid fifth-string convention") unless score["fretConvention"] == "relative-to-string-nut"
    measures = score["measures"]
    fail_with("must have 1–256 measures") unless measures.is_a?(Array) && measures.length.between?(1, 256)
    measures.each do |measure|
      fail_with("invalid measure") unless measure.is_a?(Hash) && measure["beats"].is_a?(Array)
      beats = measure["beats"]
      fail_with("invalid beat count") unless [ 4, 8, 16 ].include?(beats.length)
      beats.each do |beat|
        fail_with("invalid beat duration") unless beat.is_a?(Hash) && beat["duration"] == beats.length
        notes = beat["notes"]
        fail_with("invalid notes") unless notes.is_a?(Array) && notes.length <= 5
        strings = notes.map do |note|
          fail_with("invalid note") unless note.is_a?(Hash) && note["string"].is_a?(Integer) && note["string"].between?(1, 5) && note["fret"].is_a?(Integer) && note["fret"].between?(0, 22)
          note["string"]
        end
        fail_with("duplicate string in chord") unless strings.uniq == strings
      end
    end
    true
  end

  def self.fail_with(message)
    raise Invalid, message
  end
end
