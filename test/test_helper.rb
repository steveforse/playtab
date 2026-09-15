ENV["RAILS_ENV"] ||= "test"
require "simplecov"

# Rails 8.1 bundles Minitest 6, which no longer includes Minitest's old
# Object#stub helper. Keep test doubles local to the test process.
module TestStubbing
  def stub(name, replacement = nil, &block)
    singleton = singleton_class
    original = singleton.instance_method(name) if singleton.method_defined?(name) || singleton.private_method_defined?(name)
    visibility = if singleton.private_method_defined?(name)
      :private
    elsif singleton.protected_method_defined?(name)
      :protected
    else
      :public
    end
    singleton.define_method(name) do |*args, &nested_block|
      replacement.respond_to?(:call) ? replacement.call(*args, &nested_block) : replacement
    end
    yield
  ensure
    if original
      singleton.define_method(name, original)
      singleton.send(visibility, name)
    else
      singleton.remove_method(name) if singleton.method_defined?(name) || singleton.private_method_defined?(name)
    end
  end
end
Object.include TestStubbing

SimpleCov.start do
  coverage_dir "coverage/ruby"
  minimum_coverage 100
  add_filter "/test/"
  add_filter "/config/"
  add_filter "/script/"
  track_files "app/**/*.rb"
  track_files "lib/**/*.rb"
end

require_relative "../config/environment"
require "rails/test_help"
require_relative "test_helpers/session_test_helper"

module ActiveSupport
  class TestCase
    # SimpleCov cannot combine the independent reports produced by parallel
    # test processes. Keep CI coverage deterministic while retaining faster
    # parallel runs for local test-only invocations.
    test_workers = ENV["CI"] ? 1 : :number_of_processors
    parallelize(workers: test_workers)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end
