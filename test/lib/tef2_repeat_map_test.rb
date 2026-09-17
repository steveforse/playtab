# frozen_string_literal: true

require "test_helper"

class Tef2RepeatMapTest < ActiveSupport::TestCase
  def decode(repeats, measure_count)
    Tef2::RepeatMap.decode(repeats, measure_count)
  end

  test "decodes a TEF2 first/second ending pair into volta records" do
    # Private snowdrop TEF repeat table, verified against TefView:
    # play 1-16, then 1-15 plus 17 as the second ending.
    repeats = [
      { start: 1, length: 16 }, { start: 1, length: 15 },
      { start: 17, length: 25 }, { start: 18, length: 41 }
    ]

    records, warnings, decoded = decode(repeats, 41)

    assert_equal [
      { measure: 0, is_open: true, is_close: false, ending_number: 0, type: :ending },
      { measure: 15, is_open: false, is_close: false, ending_number: 1, type: :ending, span: true, repeat: true },
      { measure: 16, is_open: false, is_close: false, ending_number: 2, type: :ending, span: true, repeat: false },
      # (17, 25): plain repeat of measures 18-25 (TefView).
      { measure: 17, is_open: true, is_close: false, ending_number: 0, type: :repeat },
      { measure: 24, is_open: false, is_close: true, ending_number: 0, type: :repeat }
    ], records
    assert_equal 3, decoded
    assert_empty warnings
  end

  test "treats end-of-score repeat entries as final-section markers, not repeats" do
    # snowdrop's (18, 41): TefView plays 26-41 once, with no outer repeat.
    repeats = [ { start: 18, length: 41 } ]

    records, warnings, decoded = decode(repeats, 41)

    assert_empty records
    assert_equal 0, decoded
    assert_empty warnings
  end

  test "decodes a single repeat entry as measures s+1 through e" do
    # bar-b-que: (1, 9) is printed as the forward sign at m2 and the
    # backward sign after m9.
    repeats = [ { start: 1, length: 9 } ]

    records, warnings, decoded = decode(repeats, 19)

    assert_equal [
      { measure: 1, is_open: true, is_close: false, ending_number: 0, type: :repeat },
      { measure: 8, is_open: false, is_close: true, ending_number: 0, type: :repeat }
    ], records
    assert_equal 1, decoded
    assert_empty warnings
  end

  test "keeps degenerate and out-of-bounds entries as raw metadata with warnings" do
    repeats = [
      { start: 17, length: 17 }, # degenerate (s+1 > e)
      { start: 10, length: 40 } # out of bounds
    ]

    records, warnings, decoded = decode(repeats, 23)

    assert_empty records
    assert_equal 0, decoded
    assert_equal [
      "TEF2 repeat table entry (17, 17) was not decoded; no repeat was added.",
      "TEF2 repeat table entry (10, 40) was not decoded; no repeat was added."
    ], warnings
  end

  test "ignores zero-length placeholder entries" do
    records, warnings, decoded = decode([ { start: 0, length: 0 } ], 10)

    assert_empty records
    assert_equal 0, decoded
    assert_empty warnings
  end

  test "decodes later sections at the recorded 1-based start measure" do
    # johnson boys: (1,8),(1,7),(10,17),(10,16). The printed PDFs show the
    # forward repeat signs at measures 1 and 10.
    repeats = [
      { start: 1, length: 8 }, { start: 1, length: 7 },
      { start: 10, length: 17 }, { start: 10, length: 16 }
    ]

    records, warnings, decoded = decode(repeats, 18)

    assert_equal [ 0, 7, 8, 9, 16, 17 ], records.map { |record| record[:measure] }
    assert_equal [ 7, 16 ], records.select { |record| record[:span] && record[:repeat] }.map { |record| record[:measure] }
    assert_equal 4, decoded
    assert_empty warnings
  end

  test "decodes same-start pairs even when other entries sit between them" do
    repeats = [
      { start: 1, length: 8 }, { start: 1, length: 7 },
      { start: 17, length: 25 },
      { start: 31, length: 38 }, { start: 31, length: 37 }
    ]

    records, warnings, decoded = decode(repeats, 60)

    assert_equal [ 0, 7, 8, 17, 24, 30, 37, 38 ], records.map { |record| record[:measure] }
    assert_equal 5, decoded
    assert_empty warnings
  end

  test "skips same-start groups without a verified length difference" do
    repeats = [ { start: 5, length: 9 }, { start: 5, length: 9 } ]

    records, warnings, decoded = decode(repeats, 20)

    assert_empty records
    assert_equal 0, decoded
    assert_equal [ "TEF2 repeat table has 2 entries with the same start (5); no ending was decoded." ], warnings
  end

  test "skips same-start groups with more than two entries" do
    repeats = [ { start: 5, length: 9 }, { start: 5, length: 8 }, { start: 5, length: 7 } ]

    records, warnings, decoded = decode(repeats, 20)

    assert_empty records
    assert_equal 0, decoded
    assert_equal [ "TEF2 repeat table has 3 entries with the same start (5); no ending was decoded." ], warnings
  end

  test "skips voltas whose second ending would fall past the final measure" do
    repeats = [ { start: 5, length: 40 }, { start: 5, length: 39 } ]

    records, warnings, decoded = decode(repeats, 40)

    assert_empty records
    assert_equal 0, decoded
    assert_equal [ "TEF2 repeat table entry (5, 40) is outside the score bounds; no ending was decoded." ], warnings
  end

  test "snowdrop TEF converts with volta endings and the 18-25 repeat when the private file is available" do
    path = ENV["PLAYTAB_SNOWDROP_TEF"]
    skip "Set PLAYTAB_SNOWDROP_TEF for the private snowdrop regression TEF." unless path && File.file?(path)

    result = Tef2.convert(File.binread(path))
    document = Nokogiri::XML(result[:musicxml])

    m1 = document.xpath("//part/measure[@number='1']").first
    assert_equal "forward", m1.at_xpath(".//barline[@location='left']/repeat")["direction"]

    m16 = document.xpath("//part/measure[@number='16']").first
    assert_equal [ "1", "start" ], [ m16.at_xpath(".//barline[@location='left']/ending")["number"], m16.at_xpath(".//barline[@location='left']/ending")["type"] ]
    right_16 = m16.xpath(".//barline[@location='right']").last
    assert_equal "1", right_16.at_xpath("ending")["number"]
    assert_equal "stop", right_16.at_xpath("ending")["type"]
    assert_equal "backward", right_16.at_xpath("repeat")["direction"]

    m17 = document.xpath("//part/measure[@number='17']").first
    assert_equal "2", m17.at_xpath(".//barline[@location='left']/ending")["number"]
    assert_equal "stop", m17.xpath(".//barline[@location='right']").last.at_xpath("ending")["type"]
    assert_nil m17.xpath(".//repeat").first

    # The (17, 25) entry: repeat of measures 18-25.
    m18 = document.xpath("//part/measure[@number='18']").first
    assert_equal "forward", m18.at_xpath(".//barline[@location='left']/repeat")["direction"]
    assert_nil m18.xpath(".//ending").first

    m25 = document.xpath("//part/measure[@number='25']").first
    assert_equal "backward", m25.xpath(".//barline[@location='right']").last.at_xpath("repeat")["direction"]

    assert_empty document.xpath("//part/measure[not(@number='16' or @number='25')]/barline/repeat[@direction='backward']")
  end
end
