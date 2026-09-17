#!/usr/bin/env ruby
# frozen_string_literal: true

# Compares paired TEF and vector-PDF conversions from the Brainjo corpus
# manifest at tmp/pdf-corpus/manifest.json. Both inputs run through the
# current native Ruby pipelines (Tef2.convert and PdfRecognizer +
# PdfMusicxmlBuilder), and the generated MusicXML documents are compared at
# the level alphaTab consumes them.
#
# Usage: script/compare_pdf_tef_corpus.rb [options]
#   --manifest PATH   (default tmp/pdf-corpus/manifest.json)
#   --output PATH     (default tmp/pdf-corpus/paired-comparison.json)
#   --limit N         only process the first N manifest entries
#   --ids 1,2,3       only process these manifest ids
#   --staged-pdf DIR  directory containing %03d.pdf per manifest id
#
# Private corpus sources and generated reports remain in ignored tmp/.

require "json"
require "optparse"
require "time"
require "pathname"
require "nokogiri"

$LOAD_PATH.unshift(Pathname(__dir__).join("../lib").to_s)
require "tef2"
require "tef2/pdf_recognizer"
require "tef2/pdf_musicxml_builder"

staged_pdf_dir = Pathname("tmp/pdf-corpus/pdf")

STEP_TO_SEMITONE = { "C" => 0, "D" => 2, "E" => 4, "F" => 5, "G" => 7, "A" => 9, "B" => 11 }.freeze

# Extracts a canonical note list plus score-level metadata from a MusicXML
# document produced by either the TEF or the PDF builder. TEF output has
# duplicated notation + TAB staves; the TAB staff (2) is preferred when
# present so both documents are compared on string/fret content.
class MusicXmlReader
  Result = Struct.new(:measures, :per_measures, :notes, :content_notes, :tuning, :time_signatures,
                      :chords, :sections, :lyrics, :techniques, :warnings, keyword_init: true)

  def self.read(xml)
    new(Nokogiri::XML(xml)).read
  end

  def initialize(doc)
    @doc = doc
  end

  def read
    part = @doc.xpath("//part").first
    raise "no <part> found" unless part

    all_notes = collect_notes(part)
    tab_notes = all_notes.select { |note| note[:staff] == "2" }
    notes = (tab_notes.empty? ? all_notes : tab_notes).reject { |note| note[:rest] }
    # Content notes keep chord members so per-measure multiset comparison sees
    # every printed digit, including parenthesized (ghost) and dead (x) ones.
    content_notes = notes.map do |note|
      note.merge(key: [ note[:string], note[:fret], note[:ghost], note[:dead] ])
    end
    compute_positions(notes)

    Result.new(
      measures: @doc.xpath("//part/measure").map { |m| m["number"] },
      per_measures: @doc.xpath("//part/measure").map do |m|
        [ m["number"], m.xpath("./note[not(rest)][not(chord)][string|notations/technical/string]").size ]
      end,
      notes: notes,
      content_notes: content_notes,
      tuning: tuning,
      time_signatures: time_signatures,
      chords: chords,
      sections: sections,
      lyrics: lyrics,
      techniques: techniques,
      warnings: nil
    )
  end

  private

  def collect_notes(part)
    notes = []
    current_staff = "1"
    part.xpath("./measure").each do |measure|
      measure.xpath("./note").each do |note|
        staff_el = note.at_css("staff")
        current_staff = staff_el&.text if staff_el

        notes << {
          measure: measure["number"],
          staff: current_staff,
          chord: !note.at_css("chord").nil?,
          rest: !note.at_css("rest").nil?,
          ghost: note.at_css("notehead")&.attribute("parentheses") == "yes",
          dead: note.at_css("notehead")&.text == "x",
          string: note.xpath("string|notations/technical/string").first&.text,
          fret: note.xpath("fret|notations/technical/fret").first&.text,
          pitch: pitch_midi(note),
          ticks: note.at_css("duration")&.text&.to_i,
          type: note.at_css("type")&.text
        }
      end
    end
    notes
  end

  # Cumulative tick offset within each measure, in document order.
  def compute_positions(notes)
    notes.group_by { |n| n[:measure] }.each_value do |list|
      offset = 0
      list.each do |note|
        note[:position] = offset
        offset += note[:ticks].to_i
      end
    end
  end

  def pitch_midi(note)
    pitch = note.at_css("pitch")
    return nil unless pitch

    pitch_midi(pitch)
  end

  def pitch_midi(pitch)
    step = pitch.at_css("step")&.text
    octave = pitch.at_css("octave")&.text&.to_i
    return nil if step.nil? || octave.nil? || STEP_TO_SEMITONE.key?(step) == false

    STEP_TO_SEMITONE.fetch(step) + (octave + 1) * 12 + (pitch.at_css("alter")&.text&.to_i || 0)
  end

  def tuning
    @doc.xpath("//staff-tuning").map do |t|
      step = t.at_css("tuning-step")&.text || t.at_css("pitch/step")&.text
      octave = (t.at_css("tuning-octave")&.text || t.at_css("pitch/octave")&.text)&.to_i
      midi = step && octave && semitone(step, octave, t.at_css("pitch/alter")&.text&.to_i || 0)
      midi && [ t["line"], midi ]
    end.compact.sort_by { |line, _| line.to_i }
  end

  def semitone(step, octave, alter)
    STEP_TO_SEMITONE.key?(step) ? STEP_TO_SEMITONE.fetch(step) + (octave + 1) * 12 + alter : nil
  end

  def time_signatures
    @doc.xpath("//part/measure/time").map do |t|
      beats = t.at_css("beats")&.text
      type_el = t.at_css("beats-type/type") || t.at_css("type")
      [ beats, type_el&.text ]
    end.compact
  end

  def chords
    @doc.xpath("//part/measure/harmony").map do |h|
      measure_el = h.ancestors("measure").first
      [ measure_el && measure_el["number"], h.at_css("root/root-step")&.text, h.at_css("kind")&.text ]
    end
  end

  def sections
    (@doc.xpath("//part/measure/direction/direction-type/text") +
      @doc.xpath("//part/measure/text")).map { |t| t.text.strip }.reject(&:empty?)
  end

  def lyrics
    @doc.at_css("//miscellaneous-field[@name='playtab-lyrics']")&.text
  end

  def techniques
    doc = @doc
    {
      h_po: doc.xpath("//notations/technical/ham-on-end").size + doc.xpath("//notations/technical/pull-off").size,
      slide: doc.xpath("//notations/technical/slide").size,
      bend: doc.xpath("//notations/technical/bend").size,
      slur: doc.xpath("//notations/technical/slur").size
    }
  end
end

def convert_tef(bytes)
  result = Tef2.convert(bytes)
  MusicXmlReader.read(result[:musicxml])
rescue StandardError => e
  { error: "#{e.class}: #{e.message}" }
end

def convert_pdf(bytes, filename)
  score = Tef2::PdfRecognizer.recognize(bytes, filename: filename)
  reader = MusicXmlReader.read(Tef2::PdfMusicxmlBuilder.build(score))
  reader.warnings = score.fetch(:warnings)
  reader
rescue StandardError => e
  { error: "#{e.class}: #{e.message}" }
end

def compare_notes(a, b)
  seq_a = a.map { |n| [ n[:string], n[:fret] ] }
  seq_b = b.map { |n| [ n[:string], n[:fret] ] }
  pos_a = a.map { |n| [ n[:measure], n[:position], n[:string], n[:fret] ] }
  pos_b = b.map { |n| [ n[:measure], n[:position], n[:string], n[:fret] ] }
  dur_a = a.map { |n| n[:ticks] }
  dur_b = b.map { |n| n[:ticks] }
  pit_a = a.map { |n| n[:pitch] }
  pit_b = b.map { |n| n[:pitch] }
  # Implied open-string pitch (pitch minus fret) removes systematic octave
  # conventions between the two MusicXML builders; differences here indicate
  # genuine tuning/pitch recognition disagreement.
  imp_a = a.map { |n| n[:pitch] && n[:pitch] - n[:fret].to_i }
  imp_b = b.map { |n| n[:pitch] && n[:pitch] - n[:fret].to_i }

  min_len = [ seq_a.size, seq_b.size ].min
  mismatches = (0...min_len).select { |i| seq_a[i] != seq_b[i] }.map do |i|
    { "index" => i, "tef" => seq_a[i], "pdf" => seq_b[i] }
  end
  {
    ordered_visible_match: seq_a == seq_b,
    unordered_visible_match: seq_a.sort == seq_b.sort,
    length_diff: (seq_a.size - seq_b.size).abs,
    hamming: (0...min_len).count { |i| seq_a[i] != seq_b[i] },
    first_mismatch_index: (0...min_len).find { |i| seq_a[i] != seq_b[i] },
    all_mismatches: mismatches,
    timing_mismatches: (0...min_len).count { |i| pos_a[i] != pos_b[i] },
    duration_mismatches: (0...min_len).count { |i| dur_a[i] != dur_b[i] },
    pitch_mismatches: (0...min_len).count { |i| pit_a[i] != pit_b[i] },
    implied_open_mismatches: (0...min_len).count { |i| !imp_a[i].nil? && !imp_b[i].nil? && imp_a[i] != imp_b[i] }
  }
end

# Timing- and order-independent visible content check. Chord members, ghost
# (parenthesized) and dead (x) markers are part of the visible content; tick
# positions and note order are not. Per measure we compare multisets of
# [string, fret, ghost, dead], and the whole song as one multiset so measure
# misalignment (e.g. trimmed trailing bars) does not masquerade as content
# error. Positive counts = in TEF, negative = in PDF only.
private def multiset_counts(notes)
  counts = Hash.new(0)
  notes.each { |note| counts[note[:key]] += 1 }
  counts
end

private def symmetric_diff(ta, tb)
  keys = (ta.keys | tb.keys).select { |key| ta[key] != tb[key] }
  {
    "tef_only" => keys.select { |k| ta[k] > tb[k] }.map { |k| [ k, ta[k] - tb[k] ] },
    "pdf_only" => keys.select { |k| tb[k] > ta[k] }.map { |k| [ k, tb[k] - ta[k] ] }
  }
end

def compare_content(a, b)
  by_measure_a = a.group_by { |n| n[:measure] }
  by_measure_b = b.group_by { |n| n[:measure] }
  per_measure = (by_measure_a.keys | by_measure_b.keys).sort_by(&:to_i).filter_map do |m|
    ta, tb = multiset_counts(by_measure_a[m] || []), multiset_counts(by_measure_b[m] || [])
    diff = symmetric_diff(ta, tb)
    next unless diff["tef_only"].any? || diff["pdf_only"].any?

    { "measure" => m, **diff }
  end
  global = symmetric_diff(multiset_counts(a), multiset_counts(b))
  {
    exact_content_match: global["tef_only"].empty? && global["pdf_only"].empty?,
    content_mismatch_notes: global["tef_only"].sum { |_, n| n } + global["pdf_only"].sum { |_, n| n },
    global: global,
    per_measure: per_measure
  }
end

options = { manifest: Pathname("tmp/pdf-corpus/manifest.json"),
            output: Pathname("tmp/pdf-corpus/paired-comparison.json"),
            limit: nil, ids: nil }
parser = OptionParser.new do |opts|
  opts.banner = "Usage: script/compare_pdf_tef_corpus.rb [options]"
  opts.on("--manifest PATH") { |p| options[:manifest] = Pathname(p) }
  opts.on("--output PATH") { |p| options[:output] = Pathname(p) }
  opts.on("--limit N", Integer) { |n| options[:limit] = n }
  opts.on("--ids 1,2,3") { |s| options[:ids] = s.split(",").map(&:to_i) }
  opts.on("--staged-pdf DIR") { |d| staged_pdf_dir = Pathname(d) }
end
parser.parse!

manifest = JSON.parse(options[:manifest].read)
manifest = manifest.select { |entry| options[:ids].nil? || options[:ids].include?(entry["id"]) }
manifest = manifest.first(options[:limit]) if options[:limit]

results = []
manifest.each do |entry|
  id = entry.fetch("id")
  tef_path = Pathname(entry.fetch("tef_rel"))
  pdf_path = staged_pdf_dir.join(format("%03d.pdf", id))
  fallback_pdf = Pathname(entry.fetch("pdf_source"))
  pdf_path = fallback_pdf if !pdf_path.file? && fallback_pdf.file?

  row = {
    "id" => id,
    "name" => entry.fetch("key").last,
    "folder" => entry.fetch("key").first
  }

  tef = tef_path.file? ? convert_tef(tef_path.binread) : { error: "staged TEF missing: #{tef_path}" }
  pdf = pdf_path.file? ? convert_pdf(pdf_path.binread, pdf_path.basename.to_s) : { error: "PDF not available: #{pdf_path}" }

  if tef.is_a?(Hash) || pdf.is_a?(Hash)
    row["status"] = "error"
    row["tef_error"] = tef[:error] if tef.is_a?(Hash)
    row["pdf_error"] = pdf[:error] if pdf.is_a?(Hash)
    row["rank_score"] = 10_000
  else
    row["status"] = "compared"
    row["measures_tef"] = tef.measures.size
    row["measures_pdf"] = pdf.measures.size
    row["per_measures_tef"] = tef.per_measures
    row["per_measures_pdf"] = pdf.per_measures
    row["notes_tef"] = tef.notes.size
    row["notes_pdf"] = pdf.notes.size
    row["content_notes_tef"] = tef.content_notes.size
    row["content_notes_pdf"] = pdf.content_notes.size
    row["note_comparison"] = compare_notes(tef.notes, pdf.notes)
    row["content_comparison"] = compare_content(tef.content_notes, pdf.content_notes)
    row["tuning_match"] = tef.tuning == pdf.tuning
    row["tuning_tef"] = tef.tuning
    row["tuning_pdf"] = pdf.tuning
    row["time_signatures_tef"] = tef.time_signatures
    row["time_signatures_pdf"] = pdf.time_signatures
    row["chords_tef"] = tef.chords
    row["chords_pdf"] = pdf.chords
    row["sections_tef"] = tef.sections
    row["sections_pdf"] = pdf.sections
    row["lyrics_tef"] = !tef.lyrics.nil?
    row["lyrics_pdf"] = !pdf.lyrics.nil?
    row["techniques_tef"] = tef.techniques
    row["techniques_pdf"] = pdf.techniques
    row["pdf_warnings"] = pdf.warnings if pdf.respond_to?(:warnings)

    c = row["note_comparison"]
    measure_diff = (row["measures_tef"] - row["measures_pdf"]).abs
    # Visible tablature content and timing drive the rank. Absolute pitch is
    # excluded: the two MusicXML builders apply systematic octave conventions
    # (see implied_open_mismatches for the pitch-level diagnostic).
    row["rank_score"] =
      c[:hamming] * 10 +
      c[:length_diff] * 8 +
      c[:timing_mismatches] * 3 +
      c[:duration_mismatches] * 2 +
      measure_diff * 20
    # Honest rank: order- and timing-independent visible content (including
    # chord members, ghost and dead markers) plus measure-count structure.
    # One local timing shift cannot cascade into this score.
    row["honest_rank_score"] =
      row["content_comparison"][:content_mismatch_notes] * 10 + measure_diff * 20
  end

  results << row
  puts "#{format('%3d', id)} #{row['name']}: #{row['status']}"
end

ranked = results.sort_by { |r| [ -r["rank_score"], r["id"] ] }
report = {
  "generated_at" => Time.now.utc.iso8601,
  "manifest" => options[:manifest].to_s,
  "pairs" => results.size,
  "compared" => results.count { |r| r["status"] == "compared" },
  "errors" => results.count { |r| r["status"] == "error" },
  "exact_visible_matches" => results.count { |r| r.dig("note_comparison", :ordered_visible_match) == true },
  "exact_content_matches" => results.count { |r| r.dig("content_comparison", :exact_content_match) == true },
  "results" => results,
  "ranking" => ranked.first(50).map do |r|
    {
      "id" => r["id"], "name" => r["name"], "score" => r["rank_score"],
      "measures" => [ r["measures_tef"], r["measures_pdf"] ],
      "notes" => [ r["notes_tef"], r["notes_pdf"] ],
      "note_comparison" => r["note_comparison"]
    }
  end
}
options[:output].write(JSON.pretty_generate(report) + "\n")
puts "\nReport: #{options[:output]}"
puts JSON.generate(report.slice("pairs", "compared", "errors", "exact_visible_matches", "exact_content_matches"))

puts "\nTop 25 by discrepancy score (TEF vs PDF):"
ranked.first(25).each do |r|
  c = r["note_comparison"]
  next unless c

  puts format(
    "%-4s %-36s score=%-5s m=%s/%s n=%s/%s ham=%s len=%s first=%s timing=%s dur=%s implOpen=%s pitch=%s",
    r["id"], r["name"][0, 36], r["rank_score"],
    r["measures_tef"], r["measures_pdf"],
    r["notes_tef"], r["notes_pdf"],
    c[:hamming], c[:length_diff], c[:first_mismatch_index].inspect,
    c[:timing_mismatches], c[:duration_mismatches], c[:implied_open_mismatches], c[:pitch_mismatches]
  )
end

honest_ranked = results.select { |r| r["status"] == "compared" }
  .sort_by { |r| [ -r["honest_rank_score"], r["id"] ] }
puts "\nTop 25 by honest content score (order/timing-independent, incl. chords/ghosts/dead):"
honest_ranked.select { |r| r["honest_rank_score"] > 0 }.first(25).each do |r|
  cc = r["content_comparison"]
  puts format(
    "%-4s %-36s content=%-5s m=%s/%s notes=%s/%s tefOnly=%s pdfOnly=%s measuresOff=%s",
    r["id"], r["name"][0, 36], r["honest_rank_score"],
    r["measures_tef"], r["measures_pdf"],
    r["content_notes_tef"], r["content_notes_pdf"],
    cc[:global]["tef_only"].sum { |_, n| n }, cc[:global]["pdf_only"].sum { |_, n| n },
    (r["measures_tef"] - r["measures_pdf"]).abs
  )
end
