#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "optparse"
require "pathname"

$LOAD_PATH.unshift(Pathname(__dir__).join("../lib").to_s)
require "tef2/pdf_recognizer"

options = { output: nil, manifest: nil }
parser = OptionParser.new do |opts|
  opts.banner = "Usage: script/check_pdf_corpus.rb ROOT [options]"
  opts.on("-o", "--output PATH", "Write the JSON report to PATH") { |path| options[:output] = Pathname(path) }
  opts.on("-m", "--manifest PATH", "Read PDF paths from a JSON corpus manifest") { |path| options[:manifest] = Pathname(path) }
end
parser.parse!

root = ARGV.empty? ? nil : Pathname(ARGV.fetch(0))
abort parser if root.nil? == options[:manifest].nil?
files = if options[:manifest]
  manifest = JSON.parse(options[:manifest].read)
  manifest.map { |item| Pathname(item.fetch("pdf_source")) }
else
  Dir.glob(root.join("**/*.pdf").to_s).sort.map { |path| Pathname(path) }
end
seen = {}
results = []

files.each do |path|
  bytes = path.binread
  digest = Digest::SHA256.hexdigest(bytes)
  if seen.key?(digest)
    results << { "path" => path.to_s, "status" => "duplicate", "duplicate_of" => seen.fetch(digest), "sha256" => digest }
    next
  end

  seen[digest] = path.to_s
  begin
    score = Tef2::PdfRecognizer.recognize(bytes, filename: path.basename.to_s)
    results << {
      "path" => path.to_s,
      "status" => "parsed",
      "sha256" => digest,
      "measures" => score.fetch(:measures),
      "notes" => score.fetch(:notes).length,
      "warnings" => score.fetch(:warnings).length
    }
  rescue StandardError => e
    results << { "path" => path.to_s, "status" => "failed", "sha256" => digest, "error" => e.message }
  end
end

summary = {
  "files" => files.length,
  "unique" => seen.length,
  "duplicates" => results.count { |item| item["status"] == "duplicate" },
  "parsed" => results.count { |item| item["status"] == "parsed" },
  "failed" => results.count { |item| item["status"] == "failed" }
}
report = { "root" => root&.to_s, "manifest" => options[:manifest]&.to_s, "summary" => summary, "files" => results }
json = JSON.pretty_generate(report) + "\n"
options[:output]&.write(json)
puts JSON.generate(summary)
abort "PDF corpus contains parse failures" unless summary["failed"].zero?
