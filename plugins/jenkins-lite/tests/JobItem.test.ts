// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import JobItem from '../src/components/JobItem.vue'
import type { JobInfo } from '../src/types'

describe('JobItem folders', () => {
  it('expands a folder and emits the nested job when it is clicked', async () => {
    const child: JobInfo = {
      name: 'deploy',
      fullName: 'team/deploy',
      url: 'http://jenkins.example/job/team/job/deploy/',
      color: 'blue'
    }
    const folder: JobInfo = {
      name: 'team',
      fullName: 'team',
      url: 'http://jenkins.example/job/team/',
      color: 'notbuilt',
      _class: 'com.cloudbees.hudson.plugins.folder.Folder',
      jobs: [child]
    }
    const expandedMap = ref<Set<string>>(new Set())
    const wrapper = mount(JobItem, {
      props: {
        job: folder,
        favorited: false,
        expandedMap: expandedMap.value
      }
    })

    expect(wrapper.findAll('.job-item')).toHaveLength(1)
    await wrapper.find('.job-info').trigger('click')

    // 模拟父组件响应 toggle-expand 事件：把 folder 的 fullName 加进 expandedMap
    const emits = wrapper.emitted('toggle-expand')
    expect(emits).toBeDefined()
    const toggled = emits![0][0] as JobInfo
    expandedMap.value = new Set([...expandedMap.value, toggled.fullName || toggled.name])
    await wrapper.setProps({ expandedMap: expandedMap.value })
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.job-item')).toHaveLength(2)
    expect(wrapper.emitted('click')).toBeUndefined()

    await wrapper.findAll('.job-info')[1].trigger('click')
    expect(wrapper.emitted('click')).toEqual([[child]])
  })

  it('shows the full job path in a flat favorites list', () => {
    const job: JobInfo = {
      name: 'deploy',
      fullName: 'team/services/deploy',
      url: 'http://jenkins.example/job/team/job/services/job/deploy/',
      color: 'blue'
    }
    const wrapper = mount(JobItem, {
      props: { job, favorited: true, showFullName: true }
    })

    expect(wrapper.find('.job-name').text()).toBe('team/services/deploy')
    expect(wrapper.find('.folder-arrow').exists()).toBe(false)
  })
})