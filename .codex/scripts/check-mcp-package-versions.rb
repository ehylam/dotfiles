#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"

offline = ARGV.delete("--offline")
unless ARGV.empty?
  warn "Usage: check-mcp-package-versions.rb [--offline]"
  exit 2
end

root_path = File.expand_path("../..", __dir__)
config_path = File.join(root_path, ".codex/config.toml")
install_path = File.join(root_path, "install.sh")
config = File.read(config_path)
install = File.read(install_path)

packages = [
  "@shopify/dev-mcp",
  "@browsermcp/mcp",
  "chrome-devtools-mcp",
  "@playwright/mcp"
]

installer_constants = {
  "@shopify/dev-mcp" => "SHOPIFY_DEV_MCP_VERSION",
  "chrome-devtools-mcp" => "CHROME_DEVTOOLS_MCP_VERSION",
  "@playwright/mcp" => "PLAYWRIGHT_MCP_VERSION"
}

wrappers = {
  "@upstash/context7-mcp" => ["context7-mcp.sh"],
  "mcp-remote" => ["github-mcp.sh"]
}

status = 0
observed = Hash.new { |hash, key| hash[key] = {} }

def check_versions(label, package, versions)
  if versions.empty?
    warn "[missing] #{package} is not pinned in #{label}"
    return [nil, 2]
  end

  if versions.length > 1
    warn "[duplicate] #{package} has multiple pins in #{label}: #{versions.join(", ")}"
    return [nil, 2]
  end

  pinned = versions.first
  unless pinned.match?(/\A\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\z/)
    warn "[floating] #{package}@#{pinned} in #{label} should be an exact version"
    return [pinned, 1]
  end

  [pinned, 0]
end

packages.each do |package|
  pinned, result = check_versions(config_path, package, config.scan(/"#{Regexp.escape(package)}@([^"]+)"/).flatten.uniq)
  status = [status, result].max
  observed[package][config_path] = pinned if pinned
end

installer_constants.each do |package, constant|
  pinned, result = check_versions(install_path, package, install.scan(/^#{Regexp.escape(constant)}="([^"]+)"$/).flatten.uniq)
  status = [status, result].max
  observed[package][install_path] = pinned if pinned
end

wrappers.each do |package, scripts|
  scripts.each do |script|
    path = File.join(root_path, ".codex/scripts", script)
    text = File.read(path)
    versions = text.scan(/(?:^|[\s"'])#{Regexp.escape(package)}(?:@([^\s"']+))?(?=[\s"']|$)/).flatten.map { |v| v || "unversioned" }.uniq
    pinned, result = check_versions(path, package, versions)
    status = [status, result].max
    observed[package][path] = pinned if pinned
  end
end

observed.each do |package, versions_by_source|
  unique_versions = versions_by_source.values.uniq
  next if unique_versions.length <= 1

  details = versions_by_source.map { |source, version| "#{source}: #{version}" }.join(", ")
  warn "[mismatch] #{package} pins differ: #{details}"
  status = [status, 1].max
end

observed.each_key do |package|
  source_versions = observed[package].values.compact.uniq
  if source_versions.empty?
    status = [status, 2].max
    next
  end

  if source_versions.length > 1
    status = [status, 1].max
    next
  end

  pinned = source_versions.first

  if offline
    puts "[ok] #{package}@#{pinned}" if status == 0
    next
  end

  stdout, stderr, result = Open3.capture3(
    "npm",
    "--cache",
    "/private/tmp/npm-cache-dotfiles",
    "--loglevel",
    "silent",
    "view",
    package,
    "version"
  )

  unless result.success?
    message = stderr.strip.empty? ? "npm view failed" : stderr.strip
    warn "[error] #{package}: #{message}"
    status = [status, 2].max
    next
  end

  latest = stdout.strip
  if pinned == latest
    puts "[ok] #{package}@#{pinned}"
  else
    puts "[update] #{package}: pinned #{pinned}, latest #{latest}"
    status = [status, 1].max
  end
end

exit status
