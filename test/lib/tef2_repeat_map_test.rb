# frozen_string_literal: true

require "test_helper"

class Tef2RepeatMapTest < ActiveSupport::TestCase
  test "decodes a TEF2 first/second ending pair into volta records" do
    # Private snowdrop TEF repeat table, verified against TefView:
    # play 1-16, then 1-15 plus 17 as the second ending.
    repeats = [
      { start: 1, length: 16 }, { start: 1, length: 15 },
      { start: 17, length: 25 }, { start: 18, length: 41 }
    ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 41)

    assert_equal [
      { measure: 0, is_open: true, is_close: false, ending_number: 0, type: :ending },
      { measure: 15, is_open: false, is_close: false, ending_number: 1, type: :ending, span: true, repeat: true },
      { measure: 16, is_open: false, is_close: false, ending_number: 2, type: :ending, span: true, repeat: false }
    ], endings
    assert_empty warnings
  end

  test "decodes later sections at the recorded 1-based start measure" do
    # johnson boys: (1,8),(1,7),(10,17),(10,16). The printed PDFs show the
    # forward repeat signs at measures 1 and 10.
    repeats = [
      { start: 1, length: 8 }, { start: 1, length: 7 },
      { start: 10, length: 17 }, { start: 10, length: 16 }
    ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 18)

    assert_equal [ 0, 7, 8, 9, 16, 17 ], endings.map { |e| e[:measure] }
    assert_equal [ 7, 16 ], endings.select { |e| e[:span] && e[:repeat] }.map { |e| e[:measure] }
    assert_empty warnings
  end

  test "decodes same-start pairs even when other entries sit between them" do
    repeats = [
      { start: 1, length: 8 }, { start: 1, length: 7 },
      { start: 17, length: 25 },
      { start: 31, length: 38 }, { start: 31, length: 37 }
    ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 60)

    assert_equal [ 0, 7, 8, 30, 37, 38 ], endings.map { |e| e[:measure] }
    assert_empty warnings
  end

  test "keeps unverified repeat entries as raw metadata without endings" do
    repeats = [ { start: 1, length: 9 }, { start: 2, length: 7 }, { start: 10, length: 19 } ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 23)

    assert_empty endings
    assert_empty warnings
  end

  test "skips same-start groups without a verified length difference" do
    repeats = [ { start: 5, length: 9 }, { start: 5, length: 9 } ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 20)

    assert_empty endings
    assert_equal [ "TEF2 repeat table has 2 entries with the same start (5); no ending was decoded." ], warnings
  end

  test "skips same-start groups with more than two entries" do
    repeats = [ { start: 5, length: 9 }, { start: 5, length: 8 }, { start: 5, length: 7 } ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 20)

    assert_empty endings
    assert_equal [ "TEF2 repeat table has 3 entries with the same start (5); no ending was decoded." ], warnings
  end

  test "skips voltas whose second ending would fall past the final measure" do
    repeats = [ { start: 5, length: 40 }, { start: 5, length: 39 } ]

    endings, warnings = Tef2::RepeatMap.volta_endings(repeats, 40)

    assert_empty endings
    assert_equal [ "TEF2 repeat table entry (5, 40) is outside the score bounds; no ending was decoded." ], warnings
  end

  test "snowdrop TEF converts with volta endings when the private file is available" do
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
  end
end
